import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrustOS - 透明AI工作台",
  description: "你能看到它在思考，你能看到它在成长",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh"><body>{children}</body></html>;
}
