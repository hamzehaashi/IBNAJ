import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Caldun", template: "%s · Caldun" },
  description: "Caldun — Investment Intelligence & Financial Modeling Workspace",
};

export const viewport: Viewport = { themeColor: "#0B0F17", width: "device-width", initialScale: 1 };

// Applies the saved theme before first paint to avoid a flash. Dark is the default.
const themeScript = `try{var t=localStorage.getItem("caldun-theme");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg text-fg">{children}</body>
    </html>
  );
}
