# Generated with JReleaser 1.25.0 at 2026-07-26T08:19:03.015721778Z

class Orchestrator < Formula
  desc "Local runner for Interesta Orchestrator"
  homepage "https://www.interesta.ai/orchestrator"
  version "0.3.1"

  if OS.linux? && Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.3.1/orchestrator-0.3.1-linux-aarch64.zip"
    sha256 "c0912b6e0c28583b55c86de6d2e96252737a62eaa0ef47b54681413fb518e9f0"
  end
  if OS.linux? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.3.1/orchestrator-0.3.1-linux-x86_64.zip"
    sha256 "c99efa3dc32306c0d3dce190da0f58393fea2c4bfaaba0cef2f371e33a40a7a1"
  end
  if OS.mac? && Hardware::CPU.arm?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.3.1/orchestrator-0.3.1-macos-aarch64.zip"
    sha256 "ce6bfae7afbdcefe9917d96fde61a59ab461749a3d993cd455cb32e6825a090f"
  end
  if OS.mac? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.3.1/orchestrator-0.3.1-macos-x86_64.zip"
    sha256 "43657c207f7988787fd0a5131d6d38aa63b7ef4404968e299d147a37daf97f0c"
  end

  def install
    bin.install "orchestrator" => "orchestrator"
  end

  test do
    output = shell_output("#{bin}/orchestrator --version")
    assert_match "0.3.1", output
  end
end
