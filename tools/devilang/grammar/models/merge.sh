#!/bin/bash

rm -rf merged
mkdir merged

cp  videzzo/ac97.devilang          merged/ac97.devilang
cp  videzzo/ahci.devilang          merged/ahci-hd.devilang
echo                            >> merged/ahci-hd.devilang
cat  truman/ahci-hd.devilang    >> merged/ahci-hd.devilang
cp   truman/ati-vga.devilang       merged/ati-vga.devilang

cp   truman/cirrus_vga.devilang    merged/cirrus_vga.devilang
cp  videzzo/cs4231a.devilang       merged/cs4231a.devilang

cp  videzzo/dwc2.devilang          merged/dwc2.devilang

cp  videzzo/e1000.devilang         merged/e1000.devilang
echo                            >> merged/e1000.devilang
cat  truman/e1000.devilang      >> merged/e1000.devilang
cp  videzzo/e1000e.devilang        merged/e1000e.devilang
echo                            >> merged/e1000e.devilang
cat  truman/e1000e.devilang     >> merged/e1000e.devilang
cp  videzzo/eepro100.devilang      merged/eepro100.devilang
cp  videzzo/ehci.devilang          merged/ehci.devilang
cp  videzzo/es1370.devilang        merged/es1370.devilang

cp  videzzo/floppy.devilang        merged/fdc-isa.devilang
echo                            >> merged/fdc-isa.devilang
cat  truman/fdc-isa.devilang    >> merged/fdc-isa.devilang

cp   truman/i82550.devilang        merged/i82550.devilang
cp   truman/igb.devilang           merged/igb.devilang
cp  videzzo/intel.devilang         merged/intel-hda.devilang
echo                            >> merged/intel-hda.devilang
cat  truman/intel-hda.devilang  >> merged/intel-hda.devilang

cp  videzzo/lsi53c895a.devilang    merged/lsi53c895a.devilang

cp  videzzo/megasas.devilang       merged/megasas.devilang
echo                            >> merged/meagsas.devilang
cat truman/megaraid.devilang    >> merged/meagsas.devilang

cp  videzzo/ohci.devilang          merged/ohci.devilang
echo                            >> merged/ohci.devilang
cat  truman/ohci.devilang       >> merged/ohci.devilang

cp  videzzo/pcnet.devilang         merged/pcnet.devilang

cp  videzzo/rtl8139.devilang       merged/rtl8139.devilang
echo                            >> merged/rtl8139.devilang
cat  truman/rtl8139.devilang    >> merged/rtl8139.devilang

cp  videzzo/sb16.devilang          merged/sb16.devilang
cp  videzzo/sdhci.devilang         merged/sdhci.devilang
echo                            >> merged/sdhci.devilang
cat  truman/sdhci.devilang      >> merged/sdhci.devilang

cp  videzzo/tulip.devilang         merged/tulip.devilang
cp  videzzo/uhci.devilang          merged/uhci.devilang

cp  videzzo/virtio.devilang        merged/virtio.devilang
cp  videzzo/vmxnet3.devilang       merged/vmxnet3.devilang
echo                            >> merged/vmxnet3.devilang
cat  truman/vmxnet3.devilang    >> merged/vmxnet3.devilang

cp  videzzo/xhci.devilang          merged/xhci.devilang
