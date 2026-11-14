import { Logo } from "@/components/ui";
import { getDict } from "@/lib/locale";

export default async function ShopNotFound() {
  const { t } = await getDict();
  return (
    <main className="wrap flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 py-10 text-center">
      <Logo />
      <h1 className="text-4xl font-semibold">{t.shop.notFound}</h1>
    </main>
  );
}
