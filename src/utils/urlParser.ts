export const parseVideoUrl = (url: string): string => {
  if (!url) return "";

  // Google Drive
  const driveMatch = url.match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/file\/d\/)([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }

  // Dropbox
  if (url.includes("dropbox.com")) {
    return url.replace("dl=0", "raw=1");
  }

  // OneDrive
  // OneDrive direct links are tricky, but often follow this pattern for embed/download
  if (url.includes("onedrive.live.com")) {
    // If it's a share link, we might need to convert it. 
    // This is a common way to get direct link from share link
    return url.replace("redir?", "download?").replace("view.aspx?", "download?");
  }

  // YouTube, Vimeo, Twitch, SoundCloud, Streamable, Wistia, DailyMotion, Mixcloud, Vidyard, Facebook
  // react-player handles these natively.
  return url;
};
