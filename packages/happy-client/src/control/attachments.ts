import type { HttpClient } from '../api/http';

interface RequestDownloadResponse {
  downloadUrl: string;
}

/**
 * Downloads the raw ENCRYPTED bytes of an attachment blob by its `ref`
 * (from a session-protocol file event) — two-step, matching happy-cli's
 * own downloadAttachment: POST request-download to get a url (this server
 * in local-storage mode, a presigned S3 GET url in S3 mode), then a plain
 * GET on that url. Callers still need to decrypt the result themselves
 * (Encryption.getBlobKey + decryptBlobBytes) — this only fetches ciphertext.
 */
export async function downloadAttachmentBytes(http: HttpClient, sessionId: string, ref: string): Promise<Uint8Array> {
  const { downloadUrl } = await http.post<RequestDownloadResponse>(`/v1/sessions/${sessionId}/attachments/request-download`, { ref });
  return http.getBytesFromUrl(downloadUrl);
}
