import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Se connecter" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
