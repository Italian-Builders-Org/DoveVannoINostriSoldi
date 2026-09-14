import { permanentRedirect } from 'next/navigation';

/** The report evolves in place. Keep links from the draft, without a second edition. */
export default function PublicSpendingReportRedirect() {
  permanentRedirect('/report/bilancio-stato-2025');
}
