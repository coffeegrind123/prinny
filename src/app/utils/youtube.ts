export function isYoutubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i.test(url);
}

export function getYoutubeVideoId(url: string): string | null {
  const match =
    url.match(/^https?:\/\/(www\.)?youtube\.com\/watch\?v=([\w-]+)/i) ||
    url.match(/^https?:\/\/youtu\.be\/([\w-]+)/i);
  return match ? match[2] || match[1] : null;
}
