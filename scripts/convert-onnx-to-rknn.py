#!/usr/bin/env python3
"""
Convertit un modèle Piper ONNX vers le format RKNN pour le NPU RK3588.
Utilise RKNN-Toolkit2 pour la conversion et la quantification.

Prérequis :
- Python 3.8-3.10 (requis par RKNN-Toolkit2)
- rknn-toolkit2 installé
- Modèle ONNX source disponible

Usage :
    python3 convert-onnx-to-rknn.py --input model.onnx --output model.rknn [--quantize]

Author: Diva Embedded Team
"""

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Optional

# Vérification de la version Python
if sys.version_info < (3, 8) or sys.version_info >= (3, 11):
    print("ERREUR: RKNN-Toolkit2 nécessite Python 3.8-3.10")
    print(f"Version actuelle: {sys.version}")
    sys.exit(1)

try:
    from rknn.api import RKNN
except ImportError:
    print("ERREUR: rknn-toolkit2 non installé")
    print("Installation: pip install rknn-toolkit2")
    sys.exit(1)

# Configuration des logs
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def validate_onnx_model(onnx_path: Path) -> bool:
    """Valide le modèle ONNX avant conversion."""
    try:
        import onnx
        
        model = onnx.load(str(onnx_path))
        onnx.checker.check_model(model)
        
        logger.info(f"✅ Modèle ONNX valide: {onnx_path}")
        
        # Affichage des infos du modèle
        graph = model.graph
        logger.info(f"📊 Inputs: {len(graph.input)}")
        logger.info(f"📊 Outputs: {len(graph.output)}")
        logger.info(f"📊 Nodes: {len(graph.node)}")
        
        # Liste des types d'opérateurs
        ops = set(node.op_type for node in graph.node)
        logger.info(f"📊 Opérateurs: {', '.join(sorted(ops))}")
        
        return True
        
    except ImportError:
        logger.warning("⚠️  onnx package non trouvé, validation ignorée")
        return True
    except Exception as e:
        logger.error(f"❌ Modèle ONNX invalide: {e}")
        return False

def convert_to_rknn(
    input_path: Path,
    output_path: Path,
    quantize: bool = False,
    target_platform: str = "rk3588"
) -> bool:
    """Convertit un modèle ONNX vers RKNN."""
    
    logger.info(f"🔄 Début de conversion: {input_path} → {output_path}")
    
    # Initialisation RKNN
    rknn = RKNN(verbose=True)
    
    try:
        # Configuration RKNN
        logger.info(f"⚙️  Configuration pour {target_platform}")
        
        # Chargement du modèle ONNX
        logger.info("📥 Chargement du modèle ONNX...")
        ret = rknn.load_onnx(
            model=str(input_path),
            inputs=['input'],  # Nom par défaut, à adapter selon le modèle
            input_size_list=[[1, 256]]  # Taille exemple, à adapter
        )
        if ret != 0:
            logger.error("❌ Échec du chargement ONNX")
            return False
        
        # Configuration de la quantification
        if quantize:
            logger.info("🔢 Configuration quantification INT8...")
            # Note: dataset requis pour quantification, utiliser des données représentatives
            rknn.config(
                mean_values=[0.0],
                std_values=[1.0],
                quantized_dtype='asymmetric_quantized-u8',
                quantized_algorithm='normal',
                quantized_method='channel'
            )
        else:
            logger.info("🔢 Configuration FP16 (sans quantification)")
            rknn.config(
                mean_values=[0.0],
                std_values=[1.0]
            )
        
        # Construction du modèle pour NPU
        logger.info(f"🏗️  Construction du modèle pour {target_platform}...")
        ret = rknn.build(do_quantization=quantize, dataset=None)
        if ret != 0:
            logger.error("❌ Échec de la construction")
            return False
        
        # Export du modèle RKNN
        logger.info(f"💾 Export vers {output_path}...")
        ret = rknn.export_rknn(str(output_path))
        if ret != 0:
            logger.error("❌ Échec de l'export")
            return False
        
        # Affichage des statistiques
        model_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Conversion réussie!")
        logger.info(f"📊 Taille du modèle RKNN: {model_size_mb:.1f} MB")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Erreur durant la conversion: {e}")
        return False
    
    finally:
        # Nettoyage
        rknn.release()

def test_rknn_model(rknn_path: Path, target_platform: str = "rk3588") -> bool:
    """Teste le modèle RKNN converti."""
    
    logger.info(f"🧪 Test du modèle: {rknn_path}")
    
    rknn = RKNN(verbose=False)
    
    try:
        # Chargement du modèle RKNN
        ret = rknn.load_rknn(str(rknn_path))
        if ret != 0:
            logger.error("❌ Échec du chargement RKNN")
            return False
        
        # Initialisation du runtime (simulation)
        ret = rknn.init_runtime(target=target_platform)
        if ret != 0:
            logger.error("❌ Échec d'initialisation runtime")
            return False
        
        # Test avec données factices
        import numpy as np
        test_input = np.random.randn(1, 256).astype(np.float32)
        
        # Inférence de test
        outputs = rknn.inference(inputs=[test_input])
        
        if outputs is not None:
            logger.info("✅ Test d'inférence réussi!")
            logger.info(f"📊 Forme de sortie: {[out.shape for out in outputs]}")
            return True
        else:
            logger.error("❌ Échec d'inférence")
            return False
            
    except Exception as e:
        logger.error(f"❌ Erreur durant le test: {e}")
        return False
    
    finally:
        rknn.release()

def main():
    parser = argparse.ArgumentParser(
        description="Convertit un modèle Piper ONNX vers RKNN pour RK3588"
    )
    
    parser.add_argument(
        "--input", "-i",
        type=Path,
        required=True,
        help="Chemin vers le modèle ONNX d'entrée"
    )
    
    parser.add_argument(
        "--output", "-o",
        type=Path,
        required=True,
        help="Chemin de sortie pour le modèle RKNN"
    )
    
    parser.add_argument(
        "--quantize", "-q",
        action="store_true",
        help="Active la quantification INT8 (réduit la taille et améliore les perfs NPU)"
    )
    
    parser.add_argument(
        "--target", "-t",
        choices=["rk3588", "rk3566", "rk3568"],
        default="rk3588",
        help="Plateforme cible (défaut: rk3588)"
    )
    
    parser.add_argument(
        "--test",
        action="store_true",
        help="Teste le modèle RKNN après conversion"
    )
    
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Mode verbose"
    )
    
    args = parser.parse_args()
    
    # Configuration du logging
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Vérifications
    if not args.input.exists():
        logger.error(f"❌ Fichier d'entrée introuvable: {args.input}")
        return 1
    
    if not args.input.suffix.lower() == '.onnx':
        logger.error("❌ Le fichier d'entrée doit être un .onnx")
        return 1
    
    # Validation du modèle ONNX
    if not validate_onnx_model(args.input):
        return 1
    
    # Création du dossier de sortie si nécessaire
    args.output.parent.mkdir(parents=True, exist_ok=True)
    
    # Conversion
    success = convert_to_rknn(
        args.input,
        args.output,
        quantize=args.quantize,
        target_platform=args.target
    )
    
    if not success:
        logger.error("❌ Conversion échouée")
        return 1
    
    # Test optionnel
    if args.test:
        if not test_rknn_model(args.output, args.target):
            logger.warning("⚠️  Tests échoués mais modèle converti")
            return 2
    
    logger.info("🎉 Conversion terminée avec succès!")
    
    # Conseils d'utilisation
    print("\n" + "="*60)
    print("💡 PROCHAINES ÉTAPES:")
    print(f"1. Copiez {args.output} vers votre Rock 5B+")
    print("2. Utilisez rknn-lite2 pour l'inférence runtime")
    print("3. Configurez TTS_BACKEND=npu dans votre app")
    print("="*60)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())