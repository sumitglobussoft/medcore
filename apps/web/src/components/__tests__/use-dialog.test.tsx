import { describe, it, expect } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogProvider, useConfirm, usePrompt } from "@/lib/use-dialog";

function ConfirmProbe({
  onResult,
  opts,
}: {
  onResult: (v: boolean) => void;
  opts?: Parameters<ReturnType<typeof useConfirm>>[0];
}) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => {
        const v = await confirm(
          opts ?? { title: "Delete invoice?", danger: true }
        );
        onResult(v);
      }}
    >
      ask
    </button>
  );
}

function PromptProbe({
  onResult,
  opts,
}: {
  onResult: (v: string | null) => void;
  opts?: Parameters<ReturnType<typeof usePrompt>>[0];
}) {
  const promptUser = usePrompt();
  return (
    <button
      onClick={async () => {
        const v = await promptUser(
          opts ?? { title: "Why?", label: "Reason", required: true }
        );
        onResult(v);
      }}
    >
      ask
    </button>
  );
}

describe("DialogProvider / useConfirm / usePrompt", () => {
  it("opens a confirm dialog and resolves true on confirm click", async () => {
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <ConfirmProbe onResult={(v) => results.push(v)} />
      </DialogProvider>
    );
    await userEvent.click(screen.getByText("ask"));
    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(results).toEqual([true]));
  });

  it("resolves false on cancel click", async () => {
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <ConfirmProbe onResult={(v) => results.push(v)} />
      </DialogProvider>
    );
    await userEvent.click(screen.getByText("ask"));
    await screen.findByTestId("confirm-dialog");
    await userEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(results).toEqual([false]));
  });

  it("backdrop click resolves confirm as false", async () => {
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <ConfirmProbe onResult={(v) => results.push(v)} />
      </DialogProvider>
    );
    await userEvent.click(screen.getByText("ask"));
    const dialog = await screen.findByTestId("confirm-dialog");
    act(() => {
      fireEvent.click(dialog);
    });
    await waitFor(() => expect(results).toEqual([false]));
  });

  it("opens a prompt dialog and resolves with value", async () => {
    const results: (string | null)[] = [];
    render(
      <DialogProvider>
        <PromptProbe onResult={(v) => results.push(v)} />
      </DialogProvider>
    );
    await userEvent.click(screen.getByText("ask"));
    const input = await screen.findByTestId("prompt-dialog-input");
    await userEvent.type(input, "late running");
    await userEvent.click(screen.getByTestId("prompt-dialog-confirm"));
    await waitFor(() => expect(results).toEqual(["late running"]));
  });

  it("prompt cancel resolves null", async () => {
    const results: (string | null)[] = [];
    render(
      <DialogProvider>
        <PromptProbe
          opts={{ title: "T", label: "L" }}
          onResult={(v) => results.push(v)}
        />
      </DialogProvider>
    );
    await userEvent.click(screen.getByText("ask"));
    await screen.findByTestId("prompt-dialog");
    await userEvent.click(screen.getByTestId("prompt-dialog-cancel"));
    await waitFor(() => expect(results).toEqual([null]));
  });

  it("queues multiple confirms, resolving them in order", async () => {
    const results: boolean[] = [];
    function DoubleProbe() {
      const confirm = useConfirm();
      return (
        <button
          onClick={async () => {
            // Kick off two confirms without awaiting the first — the provider
            // should queue them and show the second dialog only once the first
            // resolves.
            const p1 = confirm({ title: "One" });
            const p2 = confirm({ title: "Two" });
            results.push(await p1);
            results.push(await p2);
          }}
        >
          ask
        </button>
      );
    }

    render(
      <DialogProvider>
        <DoubleProbe />
      </DialogProvider>
    );
    await userEvent.click(screen.getByText("ask"));
    expect(await screen.findByText("One")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(await screen.findByText("Two")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(results).toEqual([true, false]));
  });

  it("required prompt blocks confirm until text entered", async () => {
    const results: (string | null)[] = [];
    render(
      <DialogProvider>
        <PromptProbe
          opts={{ title: "T", label: "L", required: true }}
          onResult={(v) => results.push(v)}
        />
      </DialogProvider>
    );
    await userEvent.click(screen.getByText("ask"));
    const confirmBtn = (await screen.findByTestId(
      "prompt-dialog-confirm"
    )) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    await userEvent.type(
      screen.getByTestId("prompt-dialog-input"),
      "ok"
    );
    expect(confirmBtn.disabled).toBe(false);
    await userEvent.click(confirmBtn);
    await waitFor(() => expect(results).toEqual(["ok"]));
  });

  it("falls back to a no-op (resolves false / null) when used outside the provider", async () => {
    const results: Array<boolean | string | null> = [];
    function Probe() {
      const confirm = useConfirm();
      const promptUser = usePrompt();
      return (
        <button
          onClick={async () => {
            results.push(await confirm({ title: "T" }));
            results.push(await promptUser({ title: "T", label: "L" }));
          }}
        >
          ask
        </button>
      );
    }
    const warnSpy = globalThis.console.warn;
    globalThis.console.warn = () => {};
    try {
      render(<Probe />);
      await userEvent.click(screen.getByText("ask"));
      await waitFor(() => expect(results).toEqual([false, null]));
    } finally {
      globalThis.console.warn = warnSpy;
    }
  });
});
