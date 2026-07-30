# Generated with JReleaser 1.25.0 at 2026-07-30T00:51:47.35559935Z

class Orchestrator < Formula
  desc "Local runner for Interesta Orchestrator"
  homepage "https://www.interesta.ai/orchestrator"
  version "0.5.0"

  if OS.linux? && Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.5.0/orchestrator-0.5.0-linux-aarch64.zip"
    sha256 "f5f0dfb99b370898753f1478cc848eb11f23ce2be026e896113a3156be9eddbe"
  end
  if OS.linux? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.5.0/orchestrator-0.5.0-linux-x86_64.zip"
    sha256 "e7ee80d5d4d4ec772534ea20c47f31c5e72d7d2a3edbdac8230a4258a926e881"
  end
  if OS.mac? && Hardware::CPU.arm?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.5.0/orchestrator-0.5.0-macos-aarch64.zip"
    sha256 "4c67810faf8bef2f807511567fcb7fe3807ad2f3773337c59e62cddd9cf4a512"
  end
  if OS.mac? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.5.0/orchestrator-0.5.0-macos-x86_64.zip"
    sha256 "017fc4a43081fc54ea7296f11a8b68c3030bb771db5f2558ac974892f95bf2e5"
  end

  def install
    bin.install "orchestrator" => "orchestrator"
  end

  test do
    output = shell_output("#{bin}/orchestrator --version")
    assert_match "0.5.0", output
  end
end
