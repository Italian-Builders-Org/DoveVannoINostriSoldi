import Script from "next/script";
import {
  GOOGLE_ANALYTICS_MEASUREMENT_ID,
  PUBLIC_SITE_URL,
} from "@/lib/site";

const PUBLIC_SITE_HOSTNAME = new URL(PUBLIC_SITE_URL).hostname;
const GOOGLE_ANALYTICS_SCRIPT_URL =
  `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}`;

export function GoogleAnalytics() {
  return (
    <Script id="google-analytics" strategy="afterInteractive">
      {`
if (window.location.hostname === ${JSON.stringify(PUBLIC_SITE_HOSTNAME)}) {
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GOOGLE_ANALYTICS_MEASUREMENT_ID}');
const analyticsScript = document.createElement('script');
analyticsScript.async = true;
analyticsScript.src = ${JSON.stringify(GOOGLE_ANALYTICS_SCRIPT_URL)};
document.head.appendChild(analyticsScript);
}
`}
    </Script>
  );
}
