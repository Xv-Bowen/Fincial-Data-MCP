import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Financial Data",
  description: "行情、历史走势、汇率与年度宏观数据。保留来源，核对差异；在云端查询，接入你的 AI 助手。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
