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

export const apiFetch = async (endpoint: string, options: any = {}) => {
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
    const isAbsolute = /^https?:\/\//i.test(endpoint);
    // On production/when apiBase is set, we want ALL /api calls to go to the backend
    const url = isAbsolute ? endpoint : (apiBase ? `${apiBase}${endpoint}` : endpoint);

    const method = (options.method || 'GET').toUpperCase();
    const defaultHeaders: Record<string, string> = {
        ...getAuthHeaders(),
    };
    if (method !== 'GET' && options.body && !('Content-Type' in (options.headers || {}))) {
        defaultHeaders['Content-Type'] = 'application/json';
    }
    const headers = { ...defaultHeaders, ...(options.headers || {}) };

    const response = await fetch(url, { ...options, method, headers });

    if (response.status === 401) {
        removeToken();
        if (typeof window !== 'undefined') {
            const isAdminPath = window.location.pathname.startsWith('/admin');
            window.location.href = isAdminPath ? '/admin/login' : '/login';
        }
    }

    return response;
};
