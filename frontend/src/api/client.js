import axios from "axios";
import { API_URL } from "../utils/constants";

export const apiClient = axios.create({
  baseURL: API_URL
});

export const setAuthToken = (token) => {
  if (token) {
    apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
    return;
  }

  delete apiClient.defaults.headers.common.Authorization;
};
