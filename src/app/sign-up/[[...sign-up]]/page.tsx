import { AuthPage } from "@/components/auth/AuthPage";
import { clerkConfigured } from "@/lib/auth/clerk";
export default function SignUpPage() { return <AuthPage configured={clerkConfigured()} signUp />; }
