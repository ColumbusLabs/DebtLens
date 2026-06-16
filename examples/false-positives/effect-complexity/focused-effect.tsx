import { useEffect } from "react";

interface Props {
  accountId: string;
  region: string;
  mode: "live" | "preview";
  enabled: boolean;
  refreshToken: string;
  onReady: (key: string) => void;
  onSkip: () => void;
}

export function FocusedEffect({ accountId, region, mode, enabled, refreshToken, onReady, onSkip }: Props) {
  useEffect(() => {
    if (!enabled) {
      onSkip();
      return;
    }

    const key = `${accountId}:${region}:${mode}:${refreshToken}`;
    onReady(key);
  }, [accountId, region, mode, enabled, refreshToken, onReady, onSkip]);

  return <section>{mode}</section>;
}
