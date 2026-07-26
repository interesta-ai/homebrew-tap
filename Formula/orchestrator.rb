# Generated with JReleaser 1.25.0 at 2026-07-26T06:17:43.893536546Z

class Orchestrator < Formula
  desc "Local runner for Interesta Orchestrator"
  homepage "https://www.interesta.ai/orchestrator"
  version "0.3.0"

  if OS.linux? && Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.3.0/orchestrator-0.3.0-linux-aarch64.zip"
    sha256 "800e305fdff53d3c76462cef12d7d6fde8eae74d3bb857d49dcac015131a1518"
  end
  if OS.linux? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.3.0/orchestrator-0.3.0-linux-x86_64.zip"
    sha256 "9e321145069d98e82072bac4ffe2047fcda86089c46378e8a6b3964898c0b0af"
  end
  if OS.mac? && Hardware::CPU.arm?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.3.0/orchestrator-0.3.0-macos-aarch64.zip"
    sha256 "66a669046fed7202277717ef5895d85787f35ecb544e0bbaab18936431e119f8"
  end
  if OS.mac? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.3.0/orchestrator-0.3.0-macos-x86_64.zip"
    sha256 "c9f8e7ff9d20af79773589594b46ee3ca2e1d1cd4ea99df35ce1c17b4ec6ca18"
  end

  def install
    bin.install "orchestrator" => "orchestrator"
  end

  test do
    output = shell_output("#{bin}/orchestrator --version")
    assert_match "0.3.0", output
  end
end
