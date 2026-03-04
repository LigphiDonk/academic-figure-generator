export function getApiErrorMessage(error: any, fallback: string): string {
    const data = error?.response?.data;
    const detail = data?.detail;

    const toText = (value: any): string | null => {
        if (value == null) return null;
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);

        if (Array.isArray(value)) {
            const parts = value
                .map((v) => {
                    if (typeof v === 'string') return v;
                    if (v && typeof v === 'object') {
                        if (typeof v.msg === 'string') return v.msg;
                        if (typeof v.message === 'string') return v.message;
                    }
                    try {
                        return JSON.stringify(v);
                    } catch {
                        return String(v);
                    }
                })
                .filter(Boolean);
            return parts.length ? parts.join('; ') : null;
        }

        if (value && typeof value === 'object') {
            if (typeof value.msg === 'string') return value.msg;
            if (typeof value.message === 'string') return value.message;
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }

        return null;
    };

    return (
        toText(detail) ||
        toText(data?.message) ||
        toText(error?.message) ||
        fallback
    );
}

