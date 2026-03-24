"""
test_circular_buffer.py — Tests unitaires pour CircularAudioBuffer.

Couvre : Story 27.1, AC #4, #5, #6
"""

import sys
import os
import time
import threading

# Ajouter le repertoire parent au path pour l'import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from circular_buffer import CircularAudioBuffer


def test_basic_write_read():
    """Ecrire un chunk et verifier que read_all retourne les bonnes donnees."""
    buf = CircularAudioBuffer(duration_s=1.0, sample_rate=16000, sample_width=2, channels=1)
    chunk = b"\x01\x02" * 100  # 200 bytes
    buf.write(chunk)
    result = buf.read_all()
    assert result == chunk, f"Expected {len(chunk)} bytes, got {len(result)}"
    print("PASS: test_basic_write_read")


def test_multiple_writes():
    """Ecrire plusieurs chunks et verifier la concatenation."""
    buf = CircularAudioBuffer(duration_s=1.0, sample_rate=16000, sample_width=2, channels=1)
    chunk1 = b"\x01" * 100
    chunk2 = b"\x02" * 100
    buf.write(chunk1)
    buf.write(chunk2)
    result = buf.read_all()
    assert result == chunk1 + chunk2, "Multiple writes should concatenate"
    print("PASS: test_multiple_writes")


def test_overflow_circular():
    """Ecrire plus que la taille max et verifier que seules les dernieres donnees sont conservees."""
    # Buffer de 100 bytes
    buf = CircularAudioBuffer(duration_s=0.003125, sample_rate=16000, sample_width=2, channels=1)
    # max_bytes = 0.003125 * 16000 * 2 * 1 = 100

    assert buf.max_bytes == 100, f"Expected max_bytes=100, got {buf.max_bytes}"

    # Ecrire 150 bytes (depasse le buffer)
    chunk1 = b"\x01" * 80
    chunk2 = b"\x02" * 70

    buf.write(chunk1)
    buf.write(chunk2)

    result = buf.read_all()
    # Les 50 derniers bytes de chunk1 + 70 bytes de chunk2 = non, c'est 100 derniers bytes
    # chunk1 (80 bytes) + chunk2 (70 bytes) = 150 bytes total
    # Le buffer garde les 100 derniers : 30 derniers de chunk1 + 70 de chunk2
    expected = chunk1[-30:] + chunk2
    assert len(result) == 100, f"Expected 100 bytes, got {len(result)}"
    assert result == expected, f"Circular overflow: data mismatch"
    print("PASS: test_overflow_circular")


def test_large_chunk_overflow():
    """Un chunk plus grand que le buffer entier ne garde que la fin."""
    buf = CircularAudioBuffer(duration_s=0.003125, sample_rate=16000, sample_width=2, channels=1)
    assert buf.max_bytes == 100

    big_chunk = bytes(range(256)) * 2  # 512 bytes
    buf.write(big_chunk)

    result = buf.read_all()
    assert len(result) == 100
    assert result == big_chunk[-100:]
    print("PASS: test_large_chunk_overflow")


def test_clear():
    """Verifier que clear vide le buffer."""
    buf = CircularAudioBuffer(duration_s=1.0, sample_rate=16000, sample_width=2, channels=1)
    buf.write(b"\x01" * 1000)
    assert len(buf) > 0
    buf.clear()
    assert len(buf) == 0
    result = buf.read_all()
    assert result == b"", f"Expected empty, got {len(result)} bytes"
    print("PASS: test_clear")


def test_exact_size():
    """Buffer de 3 secondes = 96000 octets a 16kHz mono 16-bit."""
    buf = CircularAudioBuffer(duration_s=3.0, sample_rate=16000, sample_width=2, channels=1)
    assert buf.max_bytes == 96000, f"Expected 96000, got {buf.max_bytes}"
    print("PASS: test_exact_size")


def test_empty_read():
    """Lire un buffer vide retourne b''."""
    buf = CircularAudioBuffer(duration_s=1.0)
    result = buf.read_all()
    assert result == b""
    assert len(buf) == 0
    print("PASS: test_empty_read")


def test_empty_write():
    """Ecrire un chunk vide ne change rien."""
    buf = CircularAudioBuffer(duration_s=1.0)
    buf.write(b"")
    assert len(buf) == 0
    assert buf.read_all() == b""
    print("PASS: test_empty_write")


def test_thread_safety():
    """Verifier que le buffer est thread-safe sous ecriture concurrente."""
    buf = CircularAudioBuffer(duration_s=0.1, sample_rate=16000, sample_width=2, channels=1)
    errors = []

    def writer(value: int, count: int):
        try:
            for _ in range(count):
                buf.write(bytes([value]) * 160)
        except Exception as e:
            errors.append(e)

    threads = [
        threading.Thread(target=writer, args=(0xAA, 100)),
        threading.Thread(target=writer, args=(0xBB, 100)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Thread errors: {errors}"
    result = buf.read_all()
    assert len(result) == buf.max_bytes, f"Expected full buffer, got {len(result)} bytes"
    print("PASS: test_thread_safety")


def test_performance_latency():
    """Verifier que l'ecriture d'un chunk prend < 5ms (AC #6)."""
    buf = CircularAudioBuffer(duration_s=3.0, sample_rate=16000, sample_width=2, channels=1)
    chunk = b"\x00" * 2560  # 1280 samples * 2 bytes (80ms chunk comme dans le vrai pipeline)

    # Warmup
    for _ in range(100):
        buf.write(chunk)

    # Mesurer
    iterations = 1000
    start = time.perf_counter()
    for _ in range(iterations):
        buf.write(chunk)
    elapsed = time.perf_counter() - start

    avg_us = (elapsed / iterations) * 1_000_000
    print(f"  Average write latency: {avg_us:.1f} us ({avg_us / 1000:.3f} ms)")
    assert avg_us < 5000, f"Write latency {avg_us:.1f} us exceeds 5ms limit"

    # Mesurer aussi read_all
    start = time.perf_counter()
    for _ in range(iterations):
        buf.read_all()
    elapsed = time.perf_counter() - start

    avg_us_read = (elapsed / iterations) * 1_000_000
    print(f"  Average read_all latency: {avg_us_read:.1f} us ({avg_us_read / 1000:.3f} ms)")
    assert avg_us_read < 5000, f"Read latency {avg_us_read:.1f} us exceeds 5ms limit"
    print("PASS: test_performance_latency")


def test_wrap_around_correctness():
    """Verifier l'ordre chronologique apres plusieurs wrap-arounds."""
    buf = CircularAudioBuffer(duration_s=0.003125, sample_rate=16000, sample_width=2, channels=1)
    assert buf.max_bytes == 100

    # Ecrire des chunks de 30 bytes avec des valeurs identifiables
    for i in range(10):
        buf.write(bytes([i]) * 30)

    # Les 100 derniers bytes = derniers ~3.33 chunks
    # chunks 7(30) + 8(30) + 9(30) = 90 bytes, mais on a ecrit 300 total
    # Derniers 100 bytes: 10 derniers de chunk7 + 30 de chunk8 + 30 de chunk9 + ... non
    # Total ecrit: 300 bytes, buffer 100
    # Les 100 derniers bytes de la sequence:
    # chunk 6: [6]*30 -> total 210
    # chunk 7: [7]*30 -> total 240  -> 40 bytes restants dans les 100 derniers
    # non, simplement: positions 200-299 dans le flux
    # chunk 6 = pos 180-209 (30 bytes)
    # chunk 7 = pos 210-239 (30 bytes)
    # chunk 8 = pos 240-269 (30 bytes)
    # chunk 9 = pos 270-299 (30 bytes)
    # Derniers 100 bytes = pos 200-299
    # = 10 derniers du chunk 6 + chunk 7 + chunk 8 + chunk 9
    # = [6]*10 + [7]*30 + [8]*30 + [9]*30

    result = buf.read_all()
    expected = bytes([6]) * 10 + bytes([7]) * 30 + bytes([8]) * 30 + bytes([9]) * 30
    assert result == expected, f"Wrap-around order mismatch: got {result[:20]}..."
    print("PASS: test_wrap_around_correctness")


if __name__ == "__main__":
    test_basic_write_read()
    test_multiple_writes()
    test_overflow_circular()
    test_large_chunk_overflow()
    test_clear()
    test_exact_size()
    test_empty_read()
    test_empty_write()
    test_thread_safety()
    test_performance_latency()
    test_wrap_around_correctness()
    print("\nAll tests passed!")
