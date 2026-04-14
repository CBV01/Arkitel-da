export const setToken = (token: string) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem('tg_auth_token', token);
    }
};

export const getToken = () => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem('tg_auth_token');
    }
    return null;
};

export const removeToken = () => {
    if (typeof window !== 'undefined') {
        localStorage.removeItem('tg_auth_token');
    }
};

export const getAuthHeaders = (): Record<string, string> => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
};

// Determine API base URL with proper environment handling
const getApiBaseUrl = (): string => {
    // Check for explicit environment variable first
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    if (envUrl && envUrl !== 'http://localhost:8000') {
        return envUrl.replace(/\/$/, '');
    }

    // In production (Hugging Face Spaces), use relative paths
    // The backend and frontend are served from the same origin
    if (typeof window !== 'undefined') {
        const isProduction = window.location.hostname !== 'localhost';
        if (isProduction) {
            return ''; // Use relative paths in production
        }
    }

    // Default to localhost for development
    return envUrl || 'http://localhost:8000';
};

export const apiFetch = async (endpoint: string, options: any = {}) => {
    const apiBase = getApiBaseUrl();
    const isAbsolute = /^https?:\/\//i.test(endpoint);
    const url = isAbsolute ? endpoint : `${apiBase}${endpoint}`;

    const method = (options.method || 'GET').toUpperCase();
    const defaultHeaders: Record<string, string> = {
        ...getAuthHeaders(),
    };
    if (method !== 'GET' && options.body && !('Content-Type' in (options.headers || {}))) {
        defaultHeaders['Content-Type'] = 'application/json';
    }
    const headers = { ...defaultHeaders, ...(options.headers || {}) };

    try {
        const response = await fetch(url, { ...options, method, headers });

        if (response.status === 401) {
            removeToken();
            if (typeof window !== 'undefined') {
                const isAdminPath = window.location.pathname.startsWith('/admin');
                window.location.href = isAdminPath ? '/admin/login' : '/login';
            }
        }

        return response;
    } catch (error) {
        console.error(`API_FETCH_ERROR: ${method} ${endpoint}`, error);
        throw new Error(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};
