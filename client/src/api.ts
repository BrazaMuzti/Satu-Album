export interface EventType {
  id: string;
  slug: string;
  name: string;
  type: string;
  preset: string;
  revealAt: string | null;
  createdAt: string;
  count?: number;
}
export interface Photo {
  id: string;
  eventSlug: string;
  url: string;
  thumb: string;
  source: string;
  createdAt: string;
}
async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || ("HTTP " + r.status));
  }
  return r.json();
}
export async function createEvent(data: { name: string; type: string; preset: string; revealAt: string | null }): Promise<{ event: EventType }> {
  return json(await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }));
}
export async function getEvent(slug: string): Promise<{ event: EventType }> {
  return json(await fetch("/api/events/" + slug));
}
export async function getPhotos(slug: string): Promise<{ photos: Photo[] }> {
  return json(await fetch("/api/events/" + slug + "/photos"));
}
export async function uploadPhoto(slug: string, blob: Blob): Promise<{ photo: Photo }> {
  const fd = new FormData();
  fd.append("photo", blob, "photo.jpg");
  return json(await fetch("/api/events/" + slug + "/photos", { method: "POST", body: fd }));
}