import * as FileSystem from "expo-file-system/legacy";

import {
  buildDownloadId,
  DownloadItem,
  getDownloads,
  upsertDownload,
} from "@/lib/downloads";
import { cancelledIds, deletedIds } from "@/lib/downloadCancellation";

type DownloadHeaders = Record<string, string>;

export type EnqueueEpisodeDownloadInput = {
  animeId: string;
  animeTitle: string;
  animeTitleByLanguage?: DownloadItem["animeTitleByLanguage"];
  cover?: string | null;
  shikimoriId?: string | null;
  anilistId?: string | null;
  episodeId: string;
  episodeTitle: string;
  episodeNumber?: string | null;
  teamSlug?: string | null;
  teamName?: string | null;
  translationType?: string | null;
  quality?: string | null;
  streamUrl: string;
  headers?: DownloadHeaders;
};

type PendingJob = EnqueueEpisodeDownloadInput & { id: string };

const OFFLINE_ROOT = `${FileSystem.documentDirectory || ""}offline_downloads/`;

const queuedIds = new Set<string>();
const queue: PendingJob[] = [];
let isDraining = false;

const toSafePathPart = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_");

const resolveAbsoluteUrl = (baseUrl: string, rawUrl: string) => {
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return rawUrl;
  }
};

const getFileExtFromUrl = (url: string, fallback = ".bin") => {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/(\.[a-zA-Z0-9]{1,8})$/);
    return match?.[1] || fallback;
  } catch {
    return fallback;
  }
};

const splitLines = (text: string) => text.replace(/\r\n/g, "\n").split("\n");

const extractTagUri = (line: string) => {
  const match = line.match(/URI="([^"]+)"/i);
  return match?.[1] || null;
};

const replaceTagUri = (line: string, nextUri: string) =>
  line.replace(/URI="([^"]+)"/i, `URI="${nextUri}"`);

const toDirectoryUri = (fileUri: string) => {
  const normalized = String(fileUri || "").trim();
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex < 0) return normalized;
  return normalized.slice(0, lastSlashIndex + 1);
};

const resolveLocalReference = (baseDirUri: string, reference: string) => {
  const normalized = String(reference || "").trim();
  if (!normalized) return "";
  if (normalized.startsWith("file://")) return normalized;
  if (normalized.startsWith("/")) return `file://${normalized}`;
  return `${baseDirUri}${normalized}`;
};

type OfflinePlaylistValidation = {
  valid: boolean;
  reason?: string;
  checkedRefs?: number;
  missingRef?: string;
};

const validateOfflinePlaylistDetailed = async (
  playlistUri: string,
): Promise<OfflinePlaylistValidation> => {
  const info = await FileSystem.getInfoAsync(playlistUri);
  if (!info.exists) {
    return { valid: false, reason: "playlist-file-missing" };
  }

  // Direct video file (e.g. video.ts) — just check it exists and has content.
  const lowerUri = playlistUri.toLowerCase();
  if (lowerUri.endsWith(".ts") || lowerUri.endsWith(".mp4")) {
    const size = (info as { size?: number }).size ?? 0;
    if (size === 0) {
      return { valid: false, reason: "video-file-empty" };
    }
    return { valid: true, checkedRefs: 0 };
  }

  let content = "";
  try {
    content = await FileSystem.readAsStringAsync(playlistUri);
  } catch {
    return { valid: false, reason: "playlist-read-failed" };
  }

  if (!content.includes("#EXTM3U")) {
    return { valid: false, reason: "playlist-invalid-header" };
  }

  const baseDirUri = toDirectoryUri(playlistUri);
  const lines = splitLines(content);
  const refs = new Set<string>();

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if (!line.startsWith("#EXT-X-KEY:") && !line.startsWith("#EXT-X-MAP:"))
        continue;
      const tagUri = extractTagUri(line);
      if (!tagUri) continue;
      refs.add(resolveLocalReference(baseDirUri, tagUri));
      continue;
    }
    refs.add(resolveLocalReference(baseDirUri, line));
  }

  if (!refs.size) {
    return { valid: false, reason: "playlist-has-no-refs" };
  }

  for (const localRef of refs) {
    const refInfo = await FileSystem.getInfoAsync(localRef);
    if (!refInfo.exists) {
      return {
        valid: false,
        reason: "playlist-missing-resource",
        missingRef: localRef,
        checkedRefs: refs.size,
      };
    }
  }

  return { valid: true, checkedRefs: refs.size };
};

const validateOfflinePlaylist = async (playlistUri: string) => {
  const result = await validateOfflinePlaylistDetailed(playlistUri);
  return result.valid;
};

const normalizeOfflinePlaylistUris = async (playlistUri: string) => {
  let content = "";
  try {
    content = await FileSystem.readAsStringAsync(playlistUri);
  } catch {
    return false;
  }

  if (!content.includes("#EXTM3U")) return false;

  const baseDirUri = toDirectoryUri(playlistUri);
  const lines = splitLines(content);
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] || "");
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      if (!line.startsWith("#EXT-X-KEY:") && !line.startsWith("#EXT-X-MAP:"))
        continue;
      const tagUri = extractTagUri(line);
      if (!tagUri) continue;
      const absoluteTagUri = resolveLocalReference(baseDirUri, tagUri);
      if (absoluteTagUri && absoluteTagUri !== tagUri) {
        lines[index] = replaceTagUri(rawLine, absoluteTagUri);
        changed = true;
      }
      continue;
    }

    const absoluteUri = resolveLocalReference(baseDirUri, line);
    if (absoluteUri && absoluteUri !== line) {
      lines[index] = absoluteUri;
      changed = true;
    }
  }

  if (!changed) return false;
  await FileSystem.writeAsStringAsync(playlistUri, lines.join("\n"));
  return true;
};

const fetchText = async (url: string, headers?: DownloadHeaders) => {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`playlist request failed (${response.status})`);
  }
  return await response.text();
};

const pickMediaPlaylistCandidates = (
  playlistText: string,
  playlistUrl: string,
) => {
  const lines = splitLines(playlistText);
  const variants: Array<{
    url: string;
    bandwidth: number;
    codecs: string;
    index: number;
  }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line || !line.startsWith("#EXT-X-STREAM-INF:")) continue;

    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
    const codecsMatch = line.match(/CODECS="([^"]+)"/i);
    let nextUri = "";
    for (let j = index + 1; j < lines.length; j += 1) {
      const candidate = lines[j]?.trim();
      if (!candidate) continue;
      if (candidate.startsWith("#")) continue;
      nextUri = candidate;
      break;
    }
    if (!nextUri) continue;

    variants.push({
      url: resolveAbsoluteUrl(playlistUrl, nextUri),
      bandwidth: Number(bandwidthMatch?.[1] || 0),
      codecs: String(codecsMatch?.[1] || "").toLowerCase(),
      index,
    });
  }

  if (!variants.length) return [playlistUrl];

  const scoreVariant = (variant: { codecs: string; bandwidth: number }) => {
    let score = 0;
    if (
      /(^|,)\s*avc\d/i.test(variant.codecs) ||
      variant.codecs.includes("h264")
    ) {
      score += 3;
    }
    if (variant.codecs.includes("mp4a") || variant.codecs.includes("aac")) {
      score += 1;
    }
    if (variant.codecs.includes("hev1") || variant.codecs.includes("hvc1")) {
      score -= 3;
    }
    // Keep lower-bitrate variants slightly preferred for offline compatibility.
    if (variant.bandwidth > 0) {
      score += Math.max(0, 2 - Math.min(2, variant.bandwidth / 3_000_000));
    }
    return score;
  };

  const ordered = [...variants].sort((left, right) => {
    const scoreDiff = scoreVariant(right) - scoreVariant(left);
    if (scoreDiff !== 0) return scoreDiff;
    return left.index - right.index;
  });

  const uniqueUrls = new Set<string>();
  const output: string[] = [];
  for (const variant of ordered) {
    if (uniqueUrls.has(variant.url)) continue;
    uniqueUrls.add(variant.url);
    output.push(variant.url);
  }

  return output.length ? output : [playlistUrl];
};

type ResourceRef = {
  lineIndex: number;
  absoluteUri: string;
  originalUri: string;
  fromTag: boolean;
};

const collectPlaylistResources = (
  playlistText: string,
  playlistUrl: string,
): ResourceRef[] => {
  const lines = splitLines(playlistText);
  const output: ResourceRef[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] || "";
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      if (!line.startsWith("#EXT-X-KEY:") && !line.startsWith("#EXT-X-MAP:"))
        continue;
      const tagUri = extractTagUri(line);
      if (!tagUri) continue;
      output.push({
        lineIndex: index,
        absoluteUri: resolveAbsoluteUrl(playlistUrl, tagUri),
        originalUri: tagUri,
        fromTag: true,
      });
      continue;
    }

    output.push({
      lineIndex: index,
      absoluteUri: resolveAbsoluteUrl(playlistUrl, line),
      originalUri: line,
      fromTag: false,
    });
  }

  return output;
};

type DownloadMediaPlaylistResult = {
  localPlaylistUri: string;
};

// iOS AVPlayer fundamentally cannot play HLS from local file:// URIs.
// The only reliable offline playback approach is a direct video file (mp4/ts).
// This function downloads all HLS segments and concatenates them into a
// single MPEG-TS file (video.ts) which AVPlayer CAN play from file://.
const downloadMediaPlaylist = async (
  mediaPlaylistUrl: string,
  storageDirUri: string,
  headers: DownloadHeaders | undefined,
  onProgress?: (progress: number) => void,
): Promise<DownloadMediaPlaylistResult> => {
  const playlistText = await fetchText(mediaPlaylistUrl, headers);
  if (playlistText.includes("#EXT-X-STREAM-INF")) {
    throw new Error("expected media playlist but got master playlist");
  }

  const lines = splitLines(playlistText);

  const allResources = collectPlaylistResources(
    lines.join("\n"),
    mediaPlaylistUrl,
  );
  const segmentResources = allResources.filter((r) => !r.fromTag);
  if (!segmentResources.length) {
    throw new Error("media playlist has no downloadable segments");
  }

  const total = Math.max(segmentResources.length, 1);
  let completed = 0;
  const seenUris = new Map<string, string>(); // absoluteUri → localPath

  // Download all segments in parallel batches of 4 for speed
  const BATCH_SIZE = 4;
  const segList = [...segmentResources];

  for (let i = 0; i < segList.length; i += BATCH_SIZE) {
    // Check cancellation between batches
    if (cancelledIds.has(storageDirUri)) {
      throw new Error("download-cancelled");
    }
    const batch = segList.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (resource) => {
      if (seenUris.has(resource.absoluteUri)) {
        completed += 1;
        onProgress?.(Math.max(0, Math.min(completed / total, 1)));
        return;
      }
      const segIndex = seenUris.size;
      const segPath = `${storageDirUri}seg_${String(segIndex).padStart(5, "0")}.ts`;
      seenUris.set(resource.absoluteUri, segPath);

      const response = await FileSystem.downloadAsync(
        resource.absoluteUri,
        segPath,
        { headers },
      );
      const statusCode = Number(response.status || 0);
      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`segment download failed (${statusCode})`);
      }
      completed += 1;
      onProgress?.(Math.max(0, Math.min(completed / total, 1)));
    }));
  }

  // Build a local m3u8 playlist pointing to downloaded segments.
  // On Android this plays fine. On iOS we try single-segment fast path first
  // (handled by the mp4 strategy above), and fall back to concatenation only
  // when there's exactly one segment (no overhead).
  const downloadedSegmentPaths = segList.map(
    (r) => seenUris.get(r.absoluteUri) ?? `${storageDirUri}seg_00000.ts`
  );

  if (downloadedSegmentPaths.length === 1) {
    // Single segment — just use it directly, no concatenation needed
    const videoTsUri = `${storageDirUri}video.ts`;
    await FileSystem.copyAsync({
      from: downloadedSegmentPaths[0],
      to: videoTsUri,
    });
    onProgress?.(1);
    return { localPlaylistUri: videoTsUri };
  }

  // Multiple segments — write a local m3u8 with absolute file:// paths.
  // This works on Android. On iOS, AVPlayer can't play local m3u8 but
  // expo-video (which uses AVPlayer) may handle it via the local server.
  // Build the playlist from the original, replacing remote URIs with local ones.
  const localLines = [...lines];
  for (const resource of allResources) {
    const localPath = seenUris.get(resource.absoluteUri);
    if (!localPath) continue;
    const localUri = localPath.startsWith("file://")
      ? localPath
      : `file://${localPath}`;
    if (resource.fromTag) {
      localLines[resource.lineIndex] = replaceTagUri(
        localLines[resource.lineIndex],
        localUri,
      );
    } else {
      localLines[resource.lineIndex] = localUri;
    }
  }

  const localPlaylistUri = `${storageDirUri}playlist.m3u8`;
  await FileSystem.writeAsStringAsync(
    localPlaylistUri,
    localLines.join("\n"),
  );

  onProgress?.(1);
  return { localPlaylistUri };
};

const ensureOfflineRoot = async () => {
  if (!FileSystem.documentDirectory) {
    throw new Error("file system is unavailable");
  }
  await FileSystem.makeDirectoryAsync(OFFLINE_ROOT, { intermediates: true });
};

// Many CDN stream URLs follow the pattern "…/filename.mp4:hls:manifest.m3u8".
// Stripping the HLS suffix yields a directly downloadable MP4 that iOS
// AVPlayer can play from file:// (unlike .ts segments or local .m3u8).
const tryExtractDirectMp4Url = (streamUrl: string): string | null => {
  try {
    // Match the mp4:hls:manifest.m3u8 suffix (with optional query string)
    const match = streamUrl.match(
      /^(https?:\/\/.+\.mp4):hls:manifest\.m3u8(\?.*)?$/i,
    );
    if (match) {
      return `${match[1]}${match[2] || ""}`;
    }
    return null;
  } catch {
    return null;
  }
};

const runDownloadJob = async (job: PendingJob) => {
  const storageDirUri = `${OFFLINE_ROOT}${toSafePathPart(job.id)}/`;

  // Check if cancelled before even starting
  if (cancelledIds.has(job.id)) {
    cancelledIds.delete(job.id);
    return;
  }

  try {
    // Write "downloading" status only inside try so cancellation in catch
    // doesn't need to undo it — if cancelled, catch handles cleanup
    await upsertDownload({
      id: job.id,
      animeId: job.animeId,
      animeTitle: job.animeTitle,
      animeTitleByLanguage: job.animeTitleByLanguage,
      cover: job.cover || null,
      episodeId: job.episodeId,
      episodeTitle: job.episodeTitle,
      episodeNumber: job.episodeNumber || null,
      teamSlug: job.teamSlug || null,
      teamName: job.teamName || null,
      translationType: job.translationType || null,
      quality: job.quality || null,
      status: "downloading",
      progress: 0,
      remoteStreamUrl: job.streamUrl,
      localPlaylistUri: null,
      storageDirUri,
      error: null,
    });

    // Check again after upsert in case cancelDownload arrived while awaiting
    if (cancelledIds.has(job.id)) {
      throw new Error("download-cancelled");
    }

    await ensureOfflineRoot();
    await FileSystem.deleteAsync(storageDirUri, { idempotent: true });
    await FileSystem.makeDirectoryAsync(storageDirUri, { intermediates: true });

    // ── Strategy 1: direct MP4 download ─────────────────────────────────────
    // iOS AVPlayer can play local .mp4 files but NOT local .m3u8 or .ts.
    // If the stream URL encodes a direct MP4 source, download it immediately.
    const directMp4Url = tryExtractDirectMp4Url(job.streamUrl);
    if (directMp4Url) {
      if (__DEV__) {
        console.log("[offline-dl] trying-direct-mp4", { directMp4Url });
      }
      const mp4Uri = `${storageDirUri}video.mp4`;
      try {
        const mp4Response = await FileSystem.downloadAsync(
          directMp4Url,
          mp4Uri,
          { headers: job.headers },
        );
        const mp4Status = Number(mp4Response.status || 0);
        if (mp4Status >= 200 && mp4Status < 300) {
          // Verify the file is actually non-empty (CDN may return 200 + 0 bytes
          // when direct MP4 access is not allowed).
          const mp4Info = await FileSystem.getInfoAsync(mp4Uri);
          const mp4Size = mp4Info.exists
            ? ((mp4Info as { size?: number }).size ?? 0)
            : 0;
          if (mp4Size === 0) {
            throw new Error(
              "direct MP4 download returned 0 bytes — CDN may not support it",
            );
          }
          if (__DEV__) {
            console.log("[offline-dl] direct-mp4-success", {
              mp4Uri,
              sizeBytes: mp4Size,
            });
          }
          await upsertDownload({
            id: job.id,
            animeId: job.animeId,
            animeTitle: job.animeTitle,
            animeTitleByLanguage: job.animeTitleByLanguage,
            cover: job.cover || null,
            episodeId: job.episodeId,
            episodeTitle: job.episodeTitle,
            episodeNumber: job.episodeNumber || null,
            teamSlug: job.teamSlug || null,
            teamName: job.teamName || null,
            translationType: job.translationType || null,
            quality: job.quality || null,
            status: "completed",
            progress: 1,
            remoteStreamUrl: job.streamUrl,
            localPlaylistUri: mp4Uri,
            storageDirUri,
            error: null,
          });
          return; // Done — skip HLS fallback
        }
      } catch (mp4Error) {
        if (__DEV__) {
          console.log("[offline-dl] direct-mp4-failed", {
            directMp4Url,
            error:
              mp4Error instanceof Error ? mp4Error.message : String(mp4Error),
          });
        }
        // Fall through to HLS strategy below
      }
    }
    // ── Strategy 2: HLS segment download (fallback) ─────────────────────────

    const initialPlaylistText = await fetchText(job.streamUrl, job.headers);
    const mediaPlaylistCandidates = pickMediaPlaylistCandidates(
      initialPlaylistText,
      job.streamUrl,
    );
    let localPlaylistUri: string | null = null;
    let lastCandidateError: unknown = null;

    for (
      let candidateIndex = 0;
      candidateIndex < mediaPlaylistCandidates.length;
      candidateIndex += 1
    ) {
      const mediaPlaylistUrl = mediaPlaylistCandidates[candidateIndex];
      try {
        await FileSystem.deleteAsync(storageDirUri, { idempotent: true });
        await FileSystem.makeDirectoryAsync(storageDirUri, {
          intermediates: true,
        });

        const result = await downloadMediaPlaylist(
          mediaPlaylistUrl,
          storageDirUri,
          job.headers,
          (progress) => {
            const progressOffset =
              candidateIndex / mediaPlaylistCandidates.length;
            const progressSpan = 1 / mediaPlaylistCandidates.length;
            const normalizedProgress = progressOffset + progress * progressSpan;
            void upsertDownload({
              id: job.id,
              animeId: job.animeId,
              animeTitle: job.animeTitle,
              animeTitleByLanguage: job.animeTitleByLanguage,
              cover: job.cover || null,
              episodeId: job.episodeId,
              episodeTitle: job.episodeTitle,
              episodeNumber: job.episodeNumber || null,
              teamSlug: job.teamSlug || null,
              teamName: job.teamName || null,
              translationType: job.translationType || null,
              quality: job.quality || null,
              status: "downloading",
              progress: normalizedProgress,
              remoteStreamUrl: job.streamUrl,
              localPlaylistUri: null,
              storageDirUri,
              error: null,
            });
          },
        );
        localPlaylistUri = result.localPlaylistUri;
        break;
      } catch (candidateError) {
        lastCandidateError = candidateError;
      }
    }

    if (!localPlaylistUri) {
      throw lastCandidateError instanceof Error
        ? lastCandidateError
        : new Error("failed to build offline media playlist");
    }

    await upsertDownload({
      id: job.id,
      animeId: job.animeId,
      animeTitle: job.animeTitle,
      animeTitleByLanguage: job.animeTitleByLanguage,
      cover: job.cover || null,
      episodeId: job.episodeId,
      episodeTitle: job.episodeTitle,
      episodeNumber: job.episodeNumber || null,
      teamSlug: job.teamSlug || null,
      teamName: job.teamName || null,
      translationType: job.translationType || null,
      quality: job.quality || null,
      status: "completed",
      progress: 1,
      remoteStreamUrl: job.streamUrl,
      localPlaylistUri,
      storageDirUri,
      error: null,
    });
  } catch (error) {
    // If cancelled — don't write failed status, removeDownload already cleaned up
    if (cancelledIds.has(job.id)) {
      cancelledIds.delete(job.id);
      await FileSystem.deleteAsync(storageDirUri, { idempotent: true });
      return;
    }
    await upsertDownload({
      id: job.id,
      animeId: job.animeId,
      animeTitle: job.animeTitle,
      animeTitleByLanguage: job.animeTitleByLanguage,
      cover: job.cover || null,
      episodeId: job.episodeId,
      episodeTitle: job.episodeTitle,
      episodeNumber: job.episodeNumber || null,
      teamSlug: job.teamSlug || null,
      teamName: job.teamName || null,
      translationType: job.translationType || null,
      quality: job.quality || null,
      status: "failed",
      progress: 0,
      remoteStreamUrl: job.streamUrl,
      localPlaylistUri: null,
      storageDirUri,
      error: error instanceof Error ? error.message : "download failed",
    });
  }
};

const drainQueue = async () => {
  if (isDraining) return;
  isDraining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) continue;
      queuedIds.delete(job.id);
      if (cancelledIds.has(job.id)) {
        cancelledIds.delete(job.id);
        continue;
      }
      await runDownloadJob(job);
    }
  } finally {
    isDraining = false;
    // If new jobs were added while draining, restart
    if (queue.length > 0) {
      void drainQueue();
    }
  }
};

export async function enqueueEpisodeDownload(
  input: EnqueueEpisodeDownloadInput,
) {
  const id = buildDownloadId(input.episodeId, input.teamSlug, input.quality);

  // Clear any deletion/cancellation flags — user explicitly wants to download
  cancelledIds.delete(id);
  deletedIds.delete(id);

  const existing = (await getDownloads()).find((item) => item.id === id);

  // Block only if actively downloading AND not cancelled
  if (
    (existing?.status === "downloading" && !cancelledIds.has(id)) ||
    queuedIds.has(id)
  ) {
    return id;
  }

  await upsertDownload({
    id,
    animeId: input.animeId,
    animeTitle: input.animeTitle,
    animeTitleByLanguage: input.animeTitleByLanguage,
    cover: input.cover || null,
    shikimoriId: input.shikimoriId || null,
    anilistId: input.anilistId || null,
    episodeId: input.episodeId,
    episodeTitle: input.episodeTitle,
    episodeNumber: input.episodeNumber || null,
    teamSlug: input.teamSlug || null,
    teamName: input.teamName || null,
    translationType: input.translationType || null,
    quality: input.quality || null,
    status: "queued",
    progress: existing?.status === "completed" ? 1 : 0,
    remoteStreamUrl: input.streamUrl,
    localPlaylistUri: existing?.localPlaylistUri || null,
    storageDirUri: existing?.storageDirUri || null,
    error: null,
    savedAt: existing?.savedAt,
  });

  queue.push({ ...input, id });
  queuedIds.add(id);
  void drainQueue();

  return id;
}

export async function getOfflinePlaylistUri(
  episodeId: string,
  teamSlug?: string | null,
  quality?: string | null,
): Promise<string | null> {
  const resolved = await resolveOfflinePlaylistUri(
    episodeId,
    teamSlug,
    quality,
  );
  return resolved.uri;
}

export type OfflinePlaylistResolution = {
  uri: string | null;
  reason: string;
  checkedCandidates: number;
  checkedUniqueUris: number;
  lastInvalidReason?: string;
};

export async function resolveOfflinePlaylistUri(
  episodeId: string,
  teamSlug?: string | null,
  quality?: string | null,
): Promise<OfflinePlaylistResolution> {
  const downloads = await getDownloads();
  const normalizedEpisodeId = String(episodeId || "").trim();
  if (!normalizedEpisodeId) {
    return {
      uri: null,
      reason: "missing-episode-id",
      checkedCandidates: 0,
      checkedUniqueUris: 0,
    };
  }

  const normalizedTeamSlug = String(teamSlug || "").trim() || null;
  const normalizedQuality = String(quality || "").trim() || null;
  const exactId = buildDownloadId(
    normalizedEpisodeId,
    normalizedTeamSlug,
    normalizedQuality,
  );
  const scoredCandidates = downloads
    .filter(
      (item) =>
        item.episodeId === normalizedEpisodeId &&
        item.status === "completed" &&
        Boolean(String(item.localPlaylistUri || "").trim()),
    )
    .map((item) => {
      const itemTeamSlug = String(item.teamSlug || "").trim() || null;
      const itemQuality = String(item.quality || "").trim() || null;
      return {
        item,
        score: [
          item.id === exactId ? 1 : 0,
          normalizedTeamSlug
            ? itemTeamSlug === normalizedTeamSlug
              ? 1
              : 0
            : 0,
          normalizedQuality ? (itemQuality === normalizedQuality ? 1 : 0) : 0,
          Number(item.updatedAt || 0),
        ] as const,
      };
    })
    .sort((left, right) => {
      for (let index = 0; index < left.score.length; index += 1) {
        const diff = right.score[index] - left.score[index];
        if (diff !== 0) return diff;
      }
      return 0;
    });

  if (!scoredCandidates.length) {
    return {
      uri: null,
      reason: "no-completed-candidates",
      checkedCandidates: 0,
      checkedUniqueUris: 0,
    };
  }

  const checked = new Set<string>();
  let lastInvalidReason: string | undefined;
  for (const candidate of scoredCandidates) {
    const uri = String(candidate.item.localPlaylistUri || "").trim();
    if (!uri || checked.has(uri)) continue;
    checked.add(uri);
    const validation = await validateOfflinePlaylistDetailed(uri);
    if (validation.valid) {
      // Percent-encode "@" in the URI so iOS AVPlayer's NSURL(string:) doesn't
      // mistake it for a userinfo separator (e.g. "/@anonymous/" in the Expo
      // sandbox). The underlying OS file access decodes "%40" back to "@".
      const playerSafeUri = uri.replace(/@/g, "%40");

      return {
        uri: playerSafeUri,
        reason: "ok",
        checkedCandidates: scoredCandidates.length,
        checkedUniqueUris: checked.size,
      };
    }
    lastInvalidReason = validation.reason;
  }

  return {
    uri: null,
    reason: "no-valid-playlists",
    checkedCandidates: scoredCandidates.length,
    checkedUniqueUris: checked.size,
    lastInvalidReason,
  };
}

export function cancelDownload(downloadId: string) {
  cancelledIds.add(downloadId);
  // Also remove from pending queue
  const idx = queue.findIndex((job) => job.id === downloadId);
  if (idx !== -1) {
    queue.splice(idx, 1);
    queuedIds.delete(downloadId);
  }
}

export async function removeOfflinePayload(storageDirUri?: string | null) {
  const target = String(storageDirUri || "").trim();
  if (!target) return;
  await FileSystem.deleteAsync(target, { idempotent: true });
}
