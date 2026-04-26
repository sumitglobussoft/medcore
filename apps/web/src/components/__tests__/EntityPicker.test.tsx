/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const { apiMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn() },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

import { EntityPicker } from "../EntityPicker";

function Harness(props: { onChange?: (id: string) => void }) {
  const [id, setId] = useState("");
  return (
    <EntityPicker
      endpoint="/patients"
      labelField="user.name"
      subtitleField="mrNumber"
      hintField="user.phone"
      value={id}
      onChange={(newId) => {
        setId(newId);
        props.onChange?.(newId);
      }}
      searchPlaceholder="Search..."
      testIdPrefix="ep"
    />
  );
}

describe("EntityPicker (Issue #84)", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  it("renders the search input with the configured placeholder", () => {
    render(<Harness />);
    expect(screen.getByTestId("ep-input")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("does not query the API for queries shorter than 2 chars", async () => {
    render(<Harness />);
    const input = screen.getByTestId("ep-input");
    await userEvent.type(input, "a");
    // Give the debounce a chance to fire.
    await new Promise((r) => setTimeout(r, 300));
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it("debounces the search and renders results from a nested labelField", async () => {
    apiMock.get.mockResolvedValueOnce({
      data: [
        {
          id: "p-1",
          mrNumber: "MR-001",
          user: { name: "Alice Smith", phone: "9876543210" },
        },
        {
          id: "p-2",
          mrNumber: "MR-002",
          user: { name: "Alvaro Bose", phone: "9999999999" },
        },
      ],
    });
    render(<Harness />);
    const input = screen.getByTestId("ep-input");
    await userEvent.type(input, "al");
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalledWith(
        expect.stringContaining("/patients?")
      );
    });
    expect(apiMock.get.mock.calls[0][0]).toMatch(/search=al/);
    await waitFor(() => {
      expect(screen.getAllByTestId("ep-option")).toHaveLength(2);
    });
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Alvaro Bose")).toBeInTheDocument();
  });

  it("emits the chosen entity's id on selection and shows the chip", async () => {
    apiMock.get.mockResolvedValueOnce({
      data: [
        {
          id: "p-7",
          mrNumber: "MR-007",
          user: { name: "Bond, James", phone: "9000000007" },
        },
      ],
    });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByTestId("ep-input");
    await userEvent.type(input, "bo");
    const option = await screen.findByTestId("ep-option");
    // Use mouseDown — the picker selects on the down event so the input
    // doesn't blur first.
    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith("p-7");
    expect(screen.getByTestId("ep-chosen-label")).toHaveTextContent(
      "Bond, James"
    );
  });

  it("shows an empty state when the API returns no rows", async () => {
    apiMock.get.mockResolvedValueOnce({ data: [] });
    render(<Harness />);
    await userEvent.type(screen.getByTestId("ep-input"), "zz");
    await waitFor(() => {
      expect(screen.getByTestId("ep-empty")).toBeInTheDocument();
    });
  });

  it("clears the chosen entity when the Change button is clicked", async () => {
    apiMock.get.mockResolvedValueOnce({
      data: [{ id: "p-7", user: { name: "Foo Bar" }, mrNumber: "MR-007" }],
    });
    render(<Harness />);
    await userEvent.type(screen.getByTestId("ep-input"), "fo");
    fireEvent.mouseDown(await screen.findByTestId("ep-option"));
    expect(screen.getByTestId("ep-chosen")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("ep-clear"));
    expect(screen.getByTestId("ep-input")).toBeInTheDocument();
  });
});
