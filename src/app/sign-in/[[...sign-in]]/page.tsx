import { AuthPage } from "@/components/auth/AuthPage";
import { clerkConfigured } from "@/lib/auth/clerk";
export default function SignInPage() { return <AuthPage configured={clerkConfigured()} />; }
