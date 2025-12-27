import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * HTTP client abstraction interface for testability
 */
export interface IHttpClient {
    request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
}

/**
 * Default implementation using axios
 */
export class AxiosHttpClient implements IHttpClient {
    async request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        return axios(config);
    }
}

