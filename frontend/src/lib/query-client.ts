import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
      retryDelay: (attemptIndex: number, error: Error) => {
        // Exponential backoff with max 8 seconds
        return Math.min(1000 * Math.pow(2, attemptIndex), 8000);
      },
      refetchOnWindowFocus: false,
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});
