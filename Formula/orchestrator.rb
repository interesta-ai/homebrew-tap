# Generated with JReleaser 1.25.0 at 2026-07-26T03:32:42.560595521Z

class Orchestrator < Formula
  desc "Local runner for Interesta Orchestrator"
  homepage "https://www.interesta.ai/orchestrator"
  version "0.2.0"

  if OS.linux? && Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.2.0/orchestrator-0.2.0-linux-aarch64.zip"
    sha256 "2b85c9a68178b81ae67394d2e490d085d829f5429c96dfa38fe86114d30d0ecc"
  end
  if OS.linux? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.2.0/orchestrator-0.2.0-linux-x86_64.zip"
    sha256 "5faea5bd2f5a5bd4da05759a6c52d5611e99bf7bddc2b9b6cf812f8f14680108"
  end
  if OS.mac? && Hardware::CPU.arm?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.2.0/orchestrator-0.2.0-macos-aarch64.zip"
    sha256 "e69d46b4d22bcab023c2d4cb5afd6cf40ee1c94e671a3e1f32dcd5a07f0a4248"
  end
  if OS.mac? && Hardware::CPU.intel?
    url "https://github.com/interesta-ai/homebrew-tap/releases/download/v0.2.0/orchestrator-0.2.0-macos-x86_64.zip"
    sha256 "8b632332f893a75560c4936e8c41f6b80592ab169b36aba204815ab3ec0c64bf"
  end

  def install
    bin.install "orchestrator" => "orchestrator"
  end

  test do
    output = shell_output("#{bin}/orchestrator --version")
    assert_match "0.2.0", output
  end
end
