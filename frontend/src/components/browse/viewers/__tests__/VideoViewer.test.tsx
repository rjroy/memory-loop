/**
 * VideoViewer Component Tests
 */

import { describe, expect, it, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VideoViewer } from "../VideoViewer";

afterEach(() => {
  cleanup();
});

describe("VideoViewer", () => {
  const defaultProps = {
    path: "videos/tutorial.mp4",
    assetBaseUrl: "/vault/test-vault/assets",
  };

  describe("basic rendering", () => {
    it("displays the filename in the header", () => {
      render(<VideoViewer {...defaultProps} />);

      expect(screen.getByText("tutorial.mp4")).toBeDefined();
    });

    it("extracts filename from nested path", () => {
      render(<VideoViewer path="deep/nested/path/clip.webm" assetBaseUrl="/vault/v1/assets" />);

      expect(screen.getByText("clip.webm")).toBeDefined();
    });

    it("renders video element with correct src", () => {
      render(<VideoViewer {...defaultProps} />);

      const video = document.querySelector("video");
      expect(video).toBeDefined();
      expect(video?.getAttribute("src")).toBe("/vault/test-vault/assets/videos/tutorial.mp4");
    });

    it("video has controls attribute", () => {
      render(<VideoViewer {...defaultProps} />);

      const video = document.querySelector("video");
      expect(video?.hasAttribute("controls")).toBe(true);
    });

    it("video has playsInline attribute for mobile", () => {
      render(<VideoViewer {...defaultProps} />);

      const video = document.querySelector("video");
      expect(video?.hasAttribute("playsinline")).toBe(true);
    });
  });

  describe("loading state", () => {
    it("shows loading state initially", () => {
      render(<VideoViewer {...defaultProps} />);

      expect(screen.getByLabelText("Loading video")).toBeDefined();
      const video = document.querySelector("video");
      expect(video?.className).toContain("video-viewer__video--loading");
    });

    it("removes loading state after video loads", () => {
      render(<VideoViewer {...defaultProps} />);

      const video = document.querySelector("video")!;
      fireEvent.loadedData(video);

      expect(screen.queryByLabelText("Loading video")).toBeNull();
      expect(video.className).not.toContain("video-viewer__video--loading");
    });
  });

  describe("error state", () => {
    it("shows error state when video fails to load", () => {
      render(<VideoViewer {...defaultProps} />);

      const video = document.querySelector("video")!;
      fireEvent.error(video);

      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText("Failed to load video")).toBeDefined();
      expect(screen.getByText(defaultProps.path)).toBeDefined();
    });

    it("hides loading state when error occurs", () => {
      render(<VideoViewer {...defaultProps} />);

      const video = document.querySelector("video")!;
      fireEvent.error(video);

      expect(screen.queryByLabelText("Loading video")).toBeNull();
    });
  });

  describe("path changes", () => {
    it("resets loading state when path changes", () => {
      const { rerender } = render(
        <VideoViewer path="first.mp4" assetBaseUrl="/vault/test/assets" />
      );

      const video = document.querySelector("video")!;

      // Load the first video
      fireEvent.loadedData(video);
      expect(video.className).not.toContain("video-viewer__video--loading");

      // Change to a different video - should reset to loading
      rerender(<VideoViewer path="second.mp4" assetBaseUrl="/vault/test/assets" />);

      const newVideo = document.querySelector("video")!;
      expect(newVideo.className).toContain("video-viewer__video--loading");
      expect(newVideo.getAttribute("src")).toBe("/vault/test/assets/second.mp4");
    });

    it("resets error state when path changes", () => {
      const { rerender } = render(
        <VideoViewer path="broken.mp4" assetBaseUrl="/vault/test/assets" />
      );

      const video = document.querySelector("video")!;

      // Simulate error on first video
      fireEvent.error(video);
      expect(screen.getByRole("alert")).toBeDefined();

      // Change to a different video - should reset error state
      rerender(<VideoViewer path="working.mp4" assetBaseUrl="/vault/test/assets" />);

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("mobile menu button", () => {
    it("does not render mobile menu button when onMobileMenuClick is not provided", () => {
      render(<VideoViewer {...defaultProps} />);

      const menuBtn = screen.queryByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeNull();
    });

    it("renders mobile menu button when onMobileMenuClick is provided", () => {
      const handleClick = () => {};
      render(<VideoViewer {...defaultProps} onMobileMenuClick={handleClick} />);

      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeDefined();
    });

    it("calls onMobileMenuClick when mobile menu button is clicked", () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };
      render(<VideoViewer {...defaultProps} onMobileMenuClick={handleClick} />);

      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      expect(clicked).toBe(true);
    });
  });

  describe("URL encoding", () => {
    it("encodes special characters in path", () => {
      render(<VideoViewer path="videos/my video (final).mp4" assetBaseUrl="/vault/v1/assets" />);

      const video = document.querySelector("video");
      expect(video?.getAttribute("src")).toBe("/vault/v1/assets/videos/my%20video%20(final).mp4");
    });
  });

  describe("delete button", () => {
    it("does not render delete button when onDelete is not provided", () => {
      render(<VideoViewer {...defaultProps} />);

      const deleteBtn = screen.queryByRole("button", { name: /delete file/i });
      expect(deleteBtn).toBeNull();
    });

    it("renders delete button when onDelete is provided", () => {
      const handleDelete = () => {};
      render(<VideoViewer {...defaultProps} onDelete={handleDelete} />);

      const deleteBtn = screen.getByRole("button", { name: /delete file/i });
      expect(deleteBtn).toBeDefined();
    });

    it("calls onDelete when delete button is clicked", () => {
      let deleted = false;
      const handleDelete = () => {
        deleted = true;
      };
      render(<VideoViewer {...defaultProps} onDelete={handleDelete} />);

      const deleteBtn = screen.getByRole("button", { name: /delete file/i });
      fireEvent.click(deleteBtn);

      expect(deleted).toBe(true);
    });
  });
});
