export interface SubtitleCue {
  id: number;
  start: number; // in seconds
  end: number;   // in seconds
  text: string;
}

// Convert "00:01:23,456" or "01:23.456" to seconds
export function timeStringToSeconds(timeStr: string): number {
  const normalized = timeStr.trim().replace(',', '.');
  const parts = normalized.split(':');
  
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]);
    const seconds = parseFloat(parts[1]);
    return minutes * 60 + seconds;
  }
  return parseFloat(normalized) || 0;
}

// Parse .srt or .vtt raw string into structured cues
export function parseSubtitleFile(rawText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  // Clean WebVTT header if present
  let text = rawText.replace(/^WEBVTT[^\r\n]*\r?\n/, '').trim();
  
  // Standardize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into blocks by double newline
  const blocks = text.split(/\n\n+/);

  let cueId = 1;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines.length) continue;

    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIndex = i;
        break;
      }
    }

    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim().split(' ')[0]);

    const start = timeStringToSeconds(startStr);
    const end = timeStringToSeconds(endStr);

    const cueLines = lines.slice(timeLineIndex + 1);
    // Strip HTML tags like <i>, <b>, <font>
    const cleanText = cueLines
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();

    if (cleanText && !isNaN(start) && !isNaN(end)) {
      cues.push({
        id: cueId++,
        start,
        end,
        text: cleanText,
      });
    }
  }

  return cues;
}

// Format seconds into MM:SS or HH:MM:SS
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Flexible timestamp input parser (e.g. "01:25:30", "45:10", "1h 20m", or pure numbers)
export function parseHumanTimeInput(input: string): number | null {
  const str = input.trim();
  if (!str) return null;

  // Pattern 1: HH:MM:SS or MM:SS
  if (str.includes(":")) {
    const parts = str.split(":").map(p => parseFloat(p.trim()));
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  // Pattern 2: "1h 20m 15s" or "45m" or "30s"
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m/i);
  const sMatch = str.match(/(\d+)\s*s/i);
  if (hMatch || mMatch || sMatch) {
    const h = hMatch ? parseInt(hMatch[1], 10) : 0;
    const m = mMatch ? parseInt(mMatch[1], 10) : 0;
    const s = sMatch ? parseInt(sMatch[1], 10) : 0;
    return h * 3600 + m * 60 + s;
  }

  // Pattern 3: Pure numbers (e.g. 45 or 90)
  const num = parseFloat(str);
  if (!isNaN(num) && num >= 0) {
    return num;
  }

  return null;
}

