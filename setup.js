import * as param from '@jkcfg/std/param'
import * as std from '@jkcfg/std'

const config = param.all();
let output = [];

const numNodes = config => config.controlPlane.nodes + config.workers.nodes;

const backend = {
  docker: {
    image: 'quay.io/footloose/centos7:0.6.0',
    // The below is required for dockerd to run smoothly.
    // See also: https://github.com/weaveworks/footloose#running-dockerd-in-container-machines
    privileged: true,
    volumes: [{
      type: 'volume',
      destination: '/var/lib/docker',
    }]
  },
  ignite: {
    image: 'chanwit/ignite-rhel7:latest', // 'chanwit/ignite-centos:7_pre2', // 'weaveworks/ignite-centos:firekube-pre3',
    privileged: false,
    volumes: [],
  },
};

const image = config => backend[config.backend].image;
const privileged = config => backend[config.backend].privileged;
const volumes = (name, config) => {
  let result = [Object.assign({}, backend[config.backend].volumes[0])];
  result[0].source = name;
  return result;
}

const footloose = config => ({
  cluster: {
    name: 'firekube',
    privateKey: 'cluster-key',
  },
  machines: [{
    count: 1,
    spec: {
      image: 'chanwit/minifk-master:1.15.9',
      name: 'master-%d',
      backend: config.backend,
      ignite: {
        cpus: 2,
        memory: '4GB',
        diskSize: '5GB',
        kernel: 'chanwit/ignite-kernel:4.19.47',
      },
      portMappings: [{
        containerPort: 22,
        hostPort: 2222,
      }, {
        containerPort: 6443,
        hostPort: 6443,
      }, {
        containerPort: 30443,
        hostPort: 30443,
      }, {
        containerPort: 30080,
        hostPort: 30080,
      }],
      privileged: privileged(config),
      volumes: volumes('minifk-0', config),
    },
  },
  {
    count: 1,
    spec: {
      image: 'chanwit/minifk-worker:1.15.9',
      name: 'worker-%d',
      backend: config.backend,
      ignite: {
        cpus: 2,
        memory: '4GB',
        diskSize: '5GB',
        kernel: 'chanwit/ignite-kernel:4.19.47',
      },
      portMappings: [{
        containerPort: 22,
        hostPort: 2222,
      }, {
        containerPort: 6443,
        hostPort: 6443,
      }, {
        containerPort: 30443,
        hostPort: 30443,
      }, {
        containerPort: 30080,
        hostPort: 30080,
      }],
      privileged: privileged(config),
      volumes: volumes('minifk-1', config),
    },
  }],
});

output.push({ path: 'footloose.yaml', value: footloose(config) });

// List is a Kubernetes list.
const List = items => ({
  apiVersion: "v1",
  kind: "List",
  items
});

// Machine returns a WKS machine description from a configuration object describing its public IP, private IP, id, and its role.
const Machine = ({ id, privateIP, sshPort, role, kubeVersion }) => ({
  apiVersion: 'cluster.k8s.io/v1alpha1',
  kind: 'Machine',
  metadata: {
    labels: {
      set: role,
    },
    name: `${role}-${id}`,
    namespace: 'weavek8sops'
  },
  spec: {
    versions: {
      kubelet: `${kubeVersion}`,
      controlPlane: `${kubeVersion}`
    },
    providerSpec: {
      value: {
        apiVersion: 'baremetalproviderspec/v1alpha1',
        kind: 'BareMetalMachineProviderSpec',
        public: {
          address: '127.0.0.1',
          port: sshPort,
        },
        private: {
          address: privateIP,
          port: 22,
        }
      }
    }
  }
});

const sshPort = machine => machine.ports.find(p => p.guest == 22).host;

if (config.machines !== undefined) {
  const machines = [];

  for (let i = 0; i < config.controlPlane.nodes; i++ ) {
    const machine = config.machines[i];
    machines.push(Machine({
      id: i,
      privateIP: machine.runtimeNetworks[0].ip,
      sshPort: sshPort(machine),
      role: 'master',
      kubeVersion: config.version,
    }));
  }

  for (let i = 0; i < config.workers.nodes; i++ ) {
    const machine = config.machines[config.controlPlane.nodes + i];
    machines.push(Machine({
      id: i,
      privateIP: machine.runtimeNetworks[0].ip,
      sshPort: sshPort(machine),
      role: 'worker',
      kubeVersion: config.version,
    }));
  }

  output.push({ path: 'machines.yaml', value: List(machines) });
}

export default output;
