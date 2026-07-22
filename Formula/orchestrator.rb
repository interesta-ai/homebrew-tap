# Generated with JReleaser 1.25.0 at 2026-07-22T22:41:59.738537668Z

class Orchestrator < Formula
  desc "Local runner for Interesta Orchestrator"
  homepage "https://www.interesta.ai/orchestrator"
  version "0.1.0"

  if OS.linux? && Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.1.0/orchestrator-0.1.0-linux-aarch64.zip"
    sha256 "f18ad71dc1b5bdcbb623e02cb982c434abd2af6cf57a899e9aa1530a36e48809"
  end
  if OS.linux? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.1.0/orchestrator-0.1.0-linux-x86_64.zip"
    sha256 "5774a8327687e0629ca47a2ad6aac675d9ca889d05a4abad906d68960a011c9c"
  end
  if OS.mac? && Hardware::CPU.arm?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.1.0/orchestrator-0.1.0-macos-aarch64.zip"
    sha256 "624535f2d226be01f9c5dbd96f404148984ee7e3cb2066a75ded4c95cedb8ce8"
  end
  if OS.mac? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.1.0/orchestrator-0.1.0-macos-x86_64.zip"
    sha256 "fb90bcf1ecead746d5fdd0bca69f77763c0f8c107219706d561ade3d9d18f0f2"
  end

  def install
    bin.install "orchestrator" => "orchestrator"
  end

  test do
    output = shell_output("#{bin}/orchestrator --version")
    assert_match "0.1.0", output
  end
end
