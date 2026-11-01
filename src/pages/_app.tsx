import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Geist } from "next/font/google";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${geist.variable} app-root`}>
      <Component {...pageProps} />
    </div>
  );
}
