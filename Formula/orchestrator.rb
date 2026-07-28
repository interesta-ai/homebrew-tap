# Generated with JReleaser 1.25.0 at 2026-07-28T03:25:29.727669674Z

class Orchestrator < Formula
  desc "Local runner for Interesta Orchestrator"
  homepage "https://www.interesta.ai/orchestrator"
  version "0.4.0"

  if OS.linux? && Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.4.0/orchestrator-0.4.0-linux-aarch64.zip"
    sha256 "5ceb5c591c9018e38e1d366fd8c1d7fbe1a41dd9b80684dbdfd96a0dcc2d4d70"
  end
  if OS.linux? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.4.0/orchestrator-0.4.0-linux-x86_64.zip"
    sha256 "cc883fde0828c5099f17f65c73c64efcca6e3c603ef2bb8ff4986c4dd21ff678"
  end
  if OS.mac? && Hardware::CPU.arm?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.4.0/orchestrator-0.4.0-macos-aarch64.zip"
    sha256 "4ef4ce018086779a7a367702d834c97335dc2d6f63bb5444daf755e354b42258"
  end
  if OS.mac? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.4.0/orchestrator-0.4.0-macos-x86_64.zip"
    sha256 "3e348d2f45d4f152bd3eba7756415f0e382d706306fc0c87d84bbe558c90f2b3"
  end

  def install
    bin.install "orchestrator" => "orchestrator"
  end

  test do
    output = shell_output("#{bin}/orchestrator --version")
    assert_match "0.4.0", output
  end
end
