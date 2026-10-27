import { useCallback, useEffect, useState } from "react"
import { ApiError, requestJson } from "./api"

export interface ApiResource<T> {
  data: T
  loading: boolean
  error: ApiError | null
  refetch: () => Promise<void>
}

export function useApiResource<T>(
  path: string,
  fallback: T,
  validate: (value: unknown) => value is T,
  refreshMs = 0,
): ApiResource<T> {
  const [data, setData] = useState<T>(fallback)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  const refetch = useCallback(async () => {
    try {
      const value = await requestJson<unknown>(path)
      if (!validate(value))
        throw new ApiError(
          `Invalid response from ${path}.`,
          0,
          "invalid_response",
        )
      setData(value)
      setError(null)
    } catch (value) {
      setError(
        value instanceof ApiError
          ? value
          : new ApiError("API request failed.", 0),
      )
    } finally {
      setLoading(false)
    }
  }, [path, validate])

  useEffect(() => {
    void refetch()
    if (!refreshMs) return
    const timer = window.setInterval(() => void refetch(), refreshMs)
    return () => window.clearInterval(timer)
  }, [refetch, refreshMs])

  return { data, loading, error, refetch }
}
