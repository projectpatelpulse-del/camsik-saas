import Link from 'next/link';

/**
 * The SaaS control plane is no longer served from the public website. Tenant creation, branding,
 * domains and builds are managed only in the authenticated Super Admin app (super_admin/).
 */
export default function SaasAdminMovedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold">SaaS administration has moved</h1>
        <p className="text-sm text-gray-500">
          Open the Super Admin app and sign in there. This page no longer accepts changes.
        </p>
        <Link href="/store" className="text-sm underline">Back to store</Link>
      </div>
    </main>
  );
}
