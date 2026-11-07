import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function PlayPage() {
  const router = useRouter();

  useEffect(() => {
    void router.replace("/?mode=practice");
  }, [router]);

  return (
    <>
      <Head>
        <title>Practice · Holonomy</title>
      </Head>
      <main className="menu-screen">
        <div className="glass menu-card opening">
          <p className="eyebrow">Holonomy</p>
          <h1>Practice</h1>
        </div>
      </main>
    </>
  );
}
