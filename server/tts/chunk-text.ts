/**
 * Creates optimal TTS chunks by intelligently splitting text and combining short sentences
 * to reduce TTS calls while maintaining natural speech flow
 */
export function createOptimalTTSChunks(
  text: string,
  maxChunkLength: number = 50
): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // First, split on sentence boundaries (more comprehensive than just periods)
  const sentences = text
    .split(/(?<=[.!?;])\s+(?=[A-Z])/g) // Split after sentence terminators followed by whitespace and capital letter
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) {
    return [text.trim()];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const potentialChunk = currentChunk
      ? `${currentChunk} ${sentence}`
      : sentence;

    // If adding this sentence would exceed max length, finalize current chunk
    if (potentialChunk.length > maxChunkLength && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk = potentialChunk;
    }

    // If this is the last sentence, add the final chunk
    if (i === sentences.length - 1) {
      chunks.push(currentChunk.trim());
    }
  }

  // Filter out empty chunks and ensure no chunk is too long
  return chunks
    .filter((chunk) => chunk.length > 0)
    .flatMap((chunk) => {
      // If a single chunk is still too long, split it further
      if (chunk.length > maxChunkLength) {
        return splitLongChunk(chunk, maxChunkLength);
      }
      return [chunk];
    });
}

/**
 * Splits a long chunk at natural breaking points (commas, conjunctions, etc.)
 */
function splitLongChunk(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Look for natural break points in reverse order of preference
    const breakPoints = [
      remaining.lastIndexOf(', ', maxLength),
      remaining.lastIndexOf(' and ', maxLength),
      remaining.lastIndexOf(' or ', maxLength),
      remaining.lastIndexOf(' but ', maxLength),
      remaining.lastIndexOf(' - ', maxLength),
      remaining.lastIndexOf(' ', maxLength) // Last resort: any space
    ];

    const breakPoint = breakPoints.find((bp) => bp > maxLength * 0.5); // Don't break too early

    if (breakPoint && breakPoint > 0) {
      chunks.push(remaining.substring(0, breakPoint + 1).trim());
      remaining = remaining.substring(breakPoint + 1).trim();
    } else {
      // No good break point found, force split at maxLength
      chunks.push(remaining.substring(0, maxLength).trim());
      remaining = remaining.substring(maxLength).trim();
    }
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

console.log(
  createOptimalTTSChunks(`
kanka bugün iki tane deli haber var. birincisi, antalya manavgat’ta bir hayvanat bahçesinden aslan kaçmış. zeus diye erkek bir aslan. sabaha karşı dışarıda uyuyan bi çiftçiye saldırmış, adamın adı süleyman. herif uyanınca aslanla boğuşmuş resmen. boynuzlarından tutup kendini savunmuş ama baya ciddi yaralanmış, başı, omzu, bacağı falan paramparça. polis gelmiş, havaya ateş açmışlar, aslan kaçmış ama sonra dronla falan yakalamışlar, vurmuşlar. hayvanat bahçesi ne halt etti de aslan kaçtı, kimse bilmiyor.`)
);
