import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsClient } from "@/components/settings/settings-client";

describe("SettingsClient desktop integration", () => {
  afterEach(() => {
    delete window.moduDesktop;
  });

  it("queries status on desktop and changes the PDF default only after a click", async () => {
    const getPdfDefaultAppStatus = vi.fn().mockResolvedValue({
      available: true,
      isDefault: false,
      defaultApplication: "org.gnome.Evince.desktop",
    });
    const setAsPdfDefaultApp = vi.fn().mockResolvedValue({
      available: true,
      isDefault: true,
      defaultApplication: "com.hzz2z.modureader.desktop",
    });
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf: vi.fn(),
      onOpenPdfAvailable: () => () => {},
      getPdfDefaultAppStatus,
      setAsPdfDefaultApp,
    };

    render(<SettingsClient />);

    const button = await screen.findByRole("button", { name: "设为 PDF 默认应用" });
    expect(getPdfDefaultAppStatus).toHaveBeenCalledOnce();
    expect(setAsPdfDefaultApp).not.toHaveBeenCalled();
    await userEvent.click(button);

    expect(setAsPdfDefaultApp).toHaveBeenCalledOnce();
    expect(await screen.findByText("墨读已是 PDF 默认应用")).toBeInTheDocument();
    await waitFor(() => expect(button).toBeDisabled());
  });
});
