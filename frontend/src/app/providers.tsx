"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { QueryClientProviderWrapper } from "@/components/providers/QueryClientProviderWrapper";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProviderWrapper>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProviderWrapper>
  );
}
