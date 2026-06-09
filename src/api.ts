const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

export function getStoredUser(): any {
  const json = localStorage.getItem('auth_user');
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

export function saveSession(token: string, user: any) {
  localStorage.setItem('auth_token', token);
  localStorage.setItem('auth_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
}

async function request<T>(method: string, path: string, body?: any): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let errText = '';
    try {
      const errJson = await res.json();
      errText = errJson.error || errJson.message || 'Erro no servidor';
    } catch {
      errText = `Erro ${res.status}: O servidor recusou o arquivo (provavelmente muito grande).`;
    }
    console.error('Falha na requisição:', errText);
    throw { error: errText };
  }

  if (res.status === 204) return undefined as any;
  return res.json();
}

export async function uploadFile(formData: FormData): Promise<any> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });

  if (!res.ok) {
    let errText = '';
    try {
      const errJson = await res.json();
      errText = errJson.error || errJson.message || `Erro ${res.status}`;
    } catch {
      errText = `Erro ${res.status}: O servidor não respondeu corretamente (pode ser o limite de tamanho).`;
    }
    console.error('Falha no Upload:', errText);
    throw { error: errText };
  }
  return res.json();
}

export const api = {
  baseUrl: API_BASE,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: any) => request<T>('POST', path, body),
  put: <T>(path: string, body: any) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: any) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  uploadFile: (file: File) => {
    const formData = new FormData();
    formData.append('foto', file);
    return uploadFile(formData);
  }
};
