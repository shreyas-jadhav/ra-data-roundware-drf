import { AuthProvider, fetchUtils, Options } from 'ra-core';

function tokenAuthProvider(options: Options = {}): AuthProvider {
  const opts = {
    obtainAuthTokenUrl: '/api-token-auth/',
    ...options,
  };
  return {
    login: async ({ username, password }) => {
      const request = new Request(opts.obtainAuthTokenUrl, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });
      const response = await fetch(request);
      if (response.ok) {
        localStorage.setItem('token', (await response.json()).token);
        return;
      }
      if (response.headers.get('content-type') !== 'application/json') {
        throw new Error(response.statusText);
      }

      const json = await response.json();
      const error = json.non_field_errors;
      throw new Error(error || response.statusText);
    },
    logout: () => {
      localStorage.removeItem('token');
      return Promise.resolve();
    },
    checkAuth: () =>
      localStorage.getItem('token') ? Promise.resolve() : Promise.reject(),
    checkError: (error) => {
      const status = error.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem('token');
        return Promise.reject();
      }
      return Promise.resolve();
    },
    getPermissions: () => {
      return Promise.resolve();
    },
  };
}

export function createOptionsFromToken() {
  const token = localStorage.getItem('token');
  if (!token) {
    return {};
  }
  return {
    user: {
      authenticated: true,
      token: 'Token ' + token,
    },
  };
}

export function fetchJsonWithAuthToken(url: string, options: object) {
  return fetchUtils.fetchJson(
    url,
    Object.assign(createOptionsFromToken(), options)
  );
}

export function XMLHttpRequestWithAuthToken(
  uri: string,
  options: Options,
  onprogress:
    | ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => any)
    | null
) {
  options = { ...options, ...createOptionsFromToken() };
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open(options.method || 'GET', uri);
    Object.keys(options.headers || {}).forEach((h) =>
      request.setRequestHeader(
        h,
        // @ts-ignore
        options.headers?.[h]
      )
    );

    if (options.user?.authenticated) {
      request.setRequestHeader(`Authorization`, options.user.token!);
    }

    request.onload = () => {
      resolve({
        json: JSON.parse(request.response),
      });
    };

    if (onprogress) request.upload.onprogress = onprogress;
    request.send(options.body as FormData);
  });
}

export default tokenAuthProvider;
