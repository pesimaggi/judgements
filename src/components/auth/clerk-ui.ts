import { isIS } from "@clerk/localizations";
import type { Appearance, LocalizationResource } from "@clerk/types";

export const localization: LocalizationResource = {
  ...isIS,
  formFieldLabel__emailAddress: "Netfang",
  formFieldLabel__emailAddress_username: "Netfang",
  formButtonPrimary: "Halda áfram",
  dividerText: "eða",
  signIn: { ...isIS.signIn, start: { ...isIS.signIn?.start,
    title: "Skrá inn á Lögbrunn", titleCombined: "Skrá inn á Lögbrunn",
    subtitle: "Sláðu inn netfangið þitt til að fá innskráningarkóða.",
    subtitleCombined: "Sláðu inn netfangið þitt til að fá innskráningarkóða.",
    actionText: "", actionLink: "Halda áfram",
  } },
  signUp: { ...isIS.signUp, start: { ...isIS.signUp?.start,
    title: "Skrá inn á Lögbrunn", subtitle: "Staðfestu netfangið þitt til að halda áfram.",
  } },
};

export const appearance: Appearance = {
  variables: { colorPrimary: "#0F2A44", colorText: "#1F2937", colorTextSecondary: "#5A6A7A",
    colorBackground: "#FFFFFF", borderRadius: "3px", fontFamily: "var(--font-sans), system-ui, sans-serif" },
  // Authentication methods are enabled in Clerk, not hidden with CSS. Keep
  // only email verification codes enabled for this initial rollout.
  layout: { showOptionalFields: false },
  elements: {
    rootBox: { width: "100%" }, cardBox: { width: "100%", boxShadow: "none" },
    card: { boxShadow: "none", border: "1px solid #E1E8F0" },
    headerTitle: { fontFamily: "var(--font-heading), Georgia, serif", color: "#0F2A44" },
  },
};
