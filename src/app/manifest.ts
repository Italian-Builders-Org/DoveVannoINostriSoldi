import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dove vanno i nostri soldi?",
    short_name: "Soldi pubblici",
    description:
      "Dati pubblici italiani spiegati in modo semplice, con la fonte sempre a portata di mano. Include un simulatore di riallocazione della Legge di Bilancio sullo stanziamento OpenBDAP, non sulla cassa.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f2f2",
    theme_color: "#f3f2f2",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
