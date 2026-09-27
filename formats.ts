// Mol* 格式注册表：structure=独立结构 / trajectory=轨迹（需 topology/model 关键词配对或同名文件自动配对）/ topology=纯拓扑（仅配对用）
export interface FormatInfo { mol: string; category: "structure" | "trajectory" | "topology"; binary?: boolean; }
export const FORMAT_REGISTRY: Record<string, FormatInfo> = {
    xyz: { mol: "xyz", category: "structure" },
    pdb: { mol: "pdb", category: "structure" },
    ent: { mol: "pdb", category: "structure" },
    sdf: { mol: "sdf", category: "structure" },
    sd: { mol: "sdf", category: "structure" },
    mol: { mol: "mol", category: "structure" },
    mol2: { mol: "mol2", category: "structure" },
    cif: { mol: "mmcif", category: "structure" },
    mcif: { mol: "mmcif", category: "structure" },
    bcif: { mol: "mmcif", category: "structure", binary: true },
    pdbqt: { mol: "pdbqt", category: "structure" },
    pqr: { mol: "pqr", category: "structure" },
    gro: { mol: "gro", category: "structure" },
    dcd: { mol: "dcd", category: "trajectory", binary: true },
    xtc: { mol: "xtc", category: "trajectory", binary: true },
    trr: { mol: "trr", category: "trajectory", binary: true },
    nc: { mol: "nctraj", category: "trajectory", binary: true },
    nctraj: { mol: "nctraj", category: "trajectory", binary: true },
    lammpstrj: { mol: "lammpstrj", category: "trajectory" },
    psf: { mol: "psf", category: "topology" },
    prmtop: { mol: "prmtop", category: "topology" },
    parm7: { mol: "prmtop", category: "topology" },
    top: { mol: "top", category: "topology" },
};
// 纯拓扑文件（仅作轨迹配对，不单独注册扩展名之外的能力）
export const TOPOLOGY_FORMATS: Record<string, string> = { psf: "psf", prmtop: "prmtop", parm7: "prmtop", top: "top" };
