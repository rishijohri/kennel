import type { FileNodeTree } from '@shared/types'

/**
 * Convert a flat list of repo-relative file paths (from `git ls-tree`) into a
 * nested directory tree, with directories sorted before files at each level.
 */
export function buildTree(rootName: string, paths: string[]): FileNodeTree {
  const root: FileNodeTree = { name: rootName, path: '', isDir: true, children: [] }

  for (const p of paths) {
    const parts = p.split('/')
    let cursor = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      acc = acc ? `${acc}/${part}` : part
      const isLeaf = i === parts.length - 1
      cursor.children ??= []
      let child = cursor.children.find((c) => c.name === part)
      if (!child) {
        child = { name: part, path: acc, isDir: !isLeaf, children: isLeaf ? undefined : [] }
        cursor.children.push(child)
      }
      cursor = child
    }
  }

  sortTree(root)
  return root
}

function sortTree(node: FileNodeTree): void {
  if (!node.children) return
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const c of node.children) sortTree(c)
}
