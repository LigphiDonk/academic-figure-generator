import { api } from './api';

function extFromContentType(contentType: string): string {
    const ct = contentType.toLowerCase();
    if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return 'jpg';
    if (ct.includes('image/png')) return 'png';
    if (ct.includes('image/webp')) return 'webp';
    if (ct.includes('application/pdf')) return 'pdf';
    return 'bin';
}

export async function fetchAuthedBlob(url: string): Promise<{
    blob: Blob;
    contentType: string;
    ext: string;
}> {
    const res = await api.get(url, { responseType: 'blob' });
    const contentType =
        (res.headers?.['content-type'] as string | undefined) || (res.data?.type as string | undefined) || '';
    const ext = extFromContentType(contentType);
    return { blob: res.data as Blob, contentType, ext };
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
    const blobUrl = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        // Give the browser a tick to start reading the blob URL before revoking.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
}

