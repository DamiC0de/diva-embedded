"""
gpu_guard.py — Surveillance GPU pour éviter la surchauffe

Fonctions utilitaires pour :
  - Vérifier la température avant chaque batch
  - Pauser l'entraînement si T > seuil
  - Limiter l'utilisation mémoire GPU

Usage dans les scripts :
    from gpu_guard import GPUGuard
    guard = GPUGuard(max_temp=80, max_memory_pct=90)
    guard.check()  # Pause si trop chaud
"""

import subprocess
import time


class GPUGuard:
    def __init__(self, max_temp: int = 80, max_memory_pct: int = 90, cooldown_temp: int = 70):
        """
        Args:
            max_temp: Température max en °C avant pause (défaut: 80)
            max_memory_pct: % max de VRAM utilisable (défaut: 90)
            cooldown_temp: Température cible pour reprendre (défaut: 70)
        """
        self.max_temp = max_temp
        self.max_memory_pct = max_memory_pct
        self.cooldown_temp = cooldown_temp
        self._check_interval = 0
        self._checks_between_queries = 50  # Query nvidia-smi toutes les 50 vérifs

    def get_gpu_temp(self) -> int:
        """Récupère la température GPU actuelle."""
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            return int(result.stdout.strip().split("\n")[0])
        except Exception:
            return 0

    def get_gpu_memory(self) -> tuple:
        """Retourne (utilisé_Mo, total_Mo)."""
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            parts = result.stdout.strip().split(",")
            return int(parts[0].strip()), int(parts[1].strip())
        except Exception:
            return 0, 1

    def get_gpu_power(self) -> tuple:
        """Retourne (puissance_actuelle_W, limite_W)."""
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=power.draw,power.limit", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            parts = result.stdout.strip().split(",")
            return float(parts[0].strip()), float(parts[1].strip())
        except Exception:
            return 0.0, 450.0

    def check(self, verbose: bool = False) -> bool:
        """
        Vérifie la température GPU. Pause si trop chaud.
        Retourne True si OK, False si on a dû attendre.

        Appeler dans la boucle d'entraînement (coût négligeable).
        """
        self._check_interval += 1
        if self._check_interval < self._checks_between_queries:
            return True
        self._check_interval = 0

        temp = self.get_gpu_temp()
        if verbose:
            power, limit = self.get_gpu_power()
            print(f"  GPU: {temp}°C | {power:.0f}W/{limit:.0f}W")

        if temp >= self.max_temp:
            print(f"\n  ⚠ GPU à {temp}°C (max: {self.max_temp}°C) — PAUSE refroidissement...")
            waited = False
            while temp > self.cooldown_temp:
                time.sleep(10)
                temp = self.get_gpu_temp()
                print(f"    Refroidissement... {temp}°C (cible: {self.cooldown_temp}°C)")
                waited = True
            if waited:
                print(f"  ✓ GPU refroidi à {temp}°C, reprise.\n")
            return False
        return True

    def limit_torch_memory(self):
        """Limite la mémoire CUDA utilisable par PyTorch."""
        try:
            import torch
            if torch.cuda.is_available():
                total_mem = torch.cuda.get_device_properties(0).total_mem
                max_mem = int(total_mem * self.max_memory_pct / 100)
                torch.cuda.set_per_process_memory_fraction(self.max_memory_pct / 100)
                print(f"  GPU VRAM limité à {self.max_memory_pct}% ({max_mem // (1024**2)} Mo)")
        except Exception as e:
            print(f"  ⚠ Impossible de limiter la VRAM : {e}")

    def status(self):
        """Affiche le statut complet du GPU."""
        temp = self.get_gpu_temp()
        used, total = self.get_gpu_memory()
        power, limit = self.get_gpu_power()
        mem_pct = used / total * 100 if total > 0 else 0

        print(f"  GPU Status:")
        print(f"    Température : {temp}°C (max: {self.max_temp}°C)")
        print(f"    VRAM        : {used} Mo / {total} Mo ({mem_pct:.0f}%)")
        print(f"    Puissance   : {power:.0f}W / {limit:.0f}W")

        if temp >= self.max_temp:
            print(f"    ⚠ ATTENTION: Température critique !")
        elif temp >= self.max_temp - 10:
            print(f"    ⚠ Température élevée")
        else:
            print(f"    ✓ OK")
