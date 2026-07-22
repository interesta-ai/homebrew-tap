# Generated with JReleaser 1.25.0 at 2026-07-22T23:00:23.150360542Z

class Orchestrator < Formula
  desc "Local runner for Interesta Orchestrator"
  homepage "https://www.interesta.ai/orchestrator"
  version "0.1.0"

  if OS.linux? && Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.1.0/orchestrator-0.1.0-linux-aarch64.zip"
    sha256 "4f3f61c6805aafdd78d1142e31f5d5092236c9f1be2335e4d600c15d7d61af4a"
  end
  if OS.linux? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.1.0/orchestrator-0.1.0-linux-x86_64.zip"
    sha256 "97b0fb7cf973acc2508e2c7e2361f6549d1c86bc30bdaa2630679a992cfb591d"
  end
  if OS.mac? && Hardware::CPU.arm?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.1.0/orchestrator-0.1.0-macos-aarch64.zip"
    sha256 "dd02dbd4ec76046858e135183c556548c619c5e224154d7b14508c1f0188ba4a"
  end
  if OS.mac? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.1.0/orchestrator-0.1.0-macos-x86_64.zip"
    sha256 "5dfa3012f388a5846ca39c42709327ad9f01f49a6a2d8ca60474ee085eb45b75"
  end

  def install
    bin.install "orchestrator" => "orchestrator"
  end

  test do
    output = shell_output("#{bin}/orchestrator --version")
    assert_match "0.1.0", output
  end
end
