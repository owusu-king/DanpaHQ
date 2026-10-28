export type VideoGuide = {
  id: string;
  title: string;
  description: string;
  src: string | null;
  kind: "video" | "youtube" | "vimeo";
  thumbnail?: string | null;
  captions?: string | null;
  unavailable?: boolean;
};
export type GuideDraft = VideoGuide & {
  url: string;
  published: boolean;
  video_file_id: string | null;
  thumbnail_file_id: string | null;
  captions_file_id: string | null;
};
export type GuideCollection = { revision: number; guides: VideoGuide[] };
export type GuideEditorData = { revision: number; guides: GuideDraft[] };
